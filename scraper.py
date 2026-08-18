import os
import time
import schedule
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local', override=True)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
ENV_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def fetch_duunitori_jobs(query: str):
    """Hakee työpaikat Duunitorin JSON-rajapinnasta."""
    url = "https://duunitori.fi/api/v1/jobentries"
    params = {"search": query, "format": "json"}
    
    results = []
    try:
        res = requests.get(url, params=params, headers=HEADERS, timeout=10)
        if res.status_code == 200:
            items = res.json().get("results", [])
            for item in items[:10]:
                slug = item.get("slug", "")
                link = f"https://duunitori.fi/tyopaikat/tyo/{slug}" if slug else "https://duunitori.fi"
                company_obj = item.get("company") or {}
                company = company_obj.get("name") if isinstance(company_obj, dict) else "Ei ilmoitettu"
                
                results.append({
                    "source": "Duunitori",
                    "title": item.get("heading", "Työpaikkailmoitus"),
                    "company": company,
                    "location": item.get("municipality_name") or "Suomi / Etätyö",
                    "link": link
                })
    except Exception as e:
        print(f"Duunitori-virhe: {e}")
    return results


def fetch_itduunit_jobs():
    """Hakee uusimmat IT-alan työpaikat ITduunit.fi-sivustolta."""
    url = "https://itduunit.fi/tyopaikat"
    results = []
    
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, "html.parser")
            job_cards = soup.select(".job-box, .grid-job, article.job, div.job-box__content")
            
            for card in job_cards[:10]:
                title_elem = card.select_one("h3, h2, .job-box__title")
                link_elem = card.select_one("a") if card.name != 'a' else card
                company_elem = card.select_one(".job-box__company, .company")
                
                if title_elem and link_elem:
                    href = link_elem.get("href", "")
                    if not href:
                        continue
                    full_link = href if href.startswith("http") else f"https://duunitori.fi{href}"
                    title = title_elem.get_text(strip=True)
                    company = company_elem.get_text(strip=True) if company_elem else "IT-yritys"
                    
                    results.append({
                        "source": "itduunit.fi",
                        "title": title,
                        "company": company,
                        "location": "IT / Etätyö",
                        "link": full_link
                    })
    except Exception as e:
        print(f"itduunit.fi -virhe: {e}")
    return results


def send_discord_alert(webhook_url: str, job: dict):
    payload = {
        "username": "Työpaikkavahti",
        "embeds": [
            {
                "title": f"🎯 Uusi työpaikka ({job['source']}): {job['title']}",
                "description": f"**Työnantaja:** {job['company']}\n**Sijainti:** {job['location']}",
                "color": 3066993 if job['source'] == 'itduunit.fi' else 3447003,
                "fields": [
                    {
                        "name": "Linkki ilmoitukseen",
                        "value": f"[Avaa työpaikkailmoitus tästä]({job['link']})",
                        "inline": False
                    }
                ],
                "footer": {
                    "text": f"Lähde: {job['source']}"
                }
            }
        ]
    }
    
    res = requests.post(webhook_url, json=payload)
    if res.status_code in [200, 204]:
        print(f"-> Viesti lähetetty Discordiin ({job['source']}): {job['title']}")
    else:
        print(f"Discord-virhe ({res.status_code}): {res.text}")


def run_watchdog():
    print("\n--- Aloitetaan työpaikkahaku ---")
    profiles_res = supabase.table("profiles").select("*").order("created_at", desc=True).limit(1).execute()
    
    db_webhook = None
    keyword = "ohjelmistokehittäjä"

    if profiles_res.data:
        profile = profiles_res.data[0]
        db_webhook = profile.get("discord_webhook_url")
        if profile.get("role_preference"):
            keyword = profile.get("role_preference")

    webhook_url = ENV_WEBHOOK or db_webhook

    if not webhook_url or ("/api/webhooks/" not in webhook_url):
        print(f"Huom: Discord Webhook URL puuttuu tai ei ole kelvollinen!")
        return

    print(f"Haetaan ilmoituksia lähteistä (Duunitori & itduunit.fi) hakusanalla: '{keyword}'...")
    
    duuni_jobs = fetch_duunitori_jobs(keyword)
    it_jobs = fetch_itduunit_jobs()
    
    all_jobs = duuni_jobs + it_jobs
    print(f"Löydettiin yhteensä {len(all_jobs)} ilmoitusta. Tarkistetaan uudet...")

    new_count = 0
    for job in all_jobs:
        job_link = job["link"]
        
        # Duplikaattitarkistus
        existing = supabase.table("seen_jobs").select("id").eq("job_url", job_link).eq("webhook_url", webhook_url).execute()
        if existing.data:
            continue

        send_discord_alert(webhook_url, job)
        new_count += 1
        
        supabase.table("seen_jobs").insert({
            "job_url": job_link,
            "webhook_url": webhook_url
        }).execute()

    print(f"Haku valmis. Uusia ilmoituksia lähetetty: {new_count}")
    print("Seuraava tarkistus klo 08:00 tai 16:00...")


if __name__ == "__main__":
    print("🤖 Työpaikkavahti käynnistetty taustalle...")
    
    # Ajetaan kerran heti käynnistyksessä
    run_watchdog()
    
    # Ajastukset 2 krt päivässä
    schedule.every().day.at("08:00").do(run_watchdog)
    schedule.every().day.at("16:00").do(run_watchdog)
    
    print("Odotetaan ajastettuja aikoja (klo 08:00 ja 16:00)...")
    while True:
        schedule.run_pending()
        time.sleep(30)
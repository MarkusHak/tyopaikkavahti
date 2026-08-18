import os
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client
from dotenv import load_dotenv
import time

load_dotenv('.env.local', override=True)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
ENV_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Kaikki seurattavat kehittäjä- ja junioriroolit
SEARCH_TERMS = [
    "ohjelmistokehittäjä",
    "software developer",
    "fullstack",
    "frontend developer",
    "backend developer",
    "software engineer",
    "junior developer",
    "junior ohjelmistokehittäjä",
    "trainee developer",
    "sovelluskehittäjä"
]


def fetch_duunitori_jobs(query: str):
    """Hakee työpaikat Duunitorin JSON-rajapinnasta annetulla hakusanalla."""
    url = "https://duunitori.fi/api/v1/jobentries"
    params = {"search": query, "format": "json"}
    
    results = []
    try:
        res = requests.get(url, params=params, headers=HEADERS, timeout=10)
        if res.status_code == 200:
            items = res.json().get("results", [])
            for item in items[:15]:
                slug = item.get("slug", "")
                link = f"https://duunitori.fi/tyopaikat/tyo/{slug}" if slug else "https://duunitori.fi"
                company_obj = item.get("company") or {}
                company = company_obj.get("name") if isinstance(company_obj, dict) else "Ei ilmoitettu"
                
                results.append({
                    "source": f"Duunitori ({query})",
                    "title": item.get("heading", "Työpaikkailmoitus"),
                    "company": company,
                    "location": item.get("municipality_name") or "Suomi / Etätyö",
                    "link": link
                })
    except Exception as e:
        print(f"Duunitori-virhe hakusanalla '{query}': {e}")
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
            
            for card in job_cards[:15]:
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
                "title": f"🎯 Uusi työpaikka: {job['title']}",
                "description": f"**Työnantaja:** {job['company']}\n**Sijainti:** {job['location']}",
                "color": 3066993 if "itduunit.fi" in job['source'] else 3447003,
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
    
    while True:
        res = requests.post(webhook_url, json=payload)
        
        if res.status_code in [200, 204]:
            print(f"-> Viesti lähetetty Discordiin ({job['source']}): {job['title']}")
            time.sleep(1)  # Pieni 1 sekunnin tauko viestien välille rate limitin välttämiseksi
            break
        elif res.status_code == 429:
            retry_after = res.json().get("retry_after", 1.5)
            print(f"⏳ Discord rate limit: odotetaan {retry_after}s...")
            time.sleep(retry_after + 0.5)
        else:
            print(f"Discord-virhe ({res.status_code}): {res.text}")
            break
    
    res = requests.post(webhook_url, json=payload)
    if res.status_code in [200, 204]:
        print(f"-> Viesti lähetetty Discordiin ({job['source']}): {job['title']}")
    else:
        print(f"Discord-virhe ({res.status_code}): {res.text}")


def run_watchdog():
    print("\n--- Aloitetaan työpaikkahaku ---")
    profiles_res = supabase.table("profiles").select("*").order("created_at", desc=True).limit(1).execute()
    
    db_webhook = None
    if profiles_res.data:
        profile = profiles_res.data[0]
        db_webhook = profile.get("discord_webhook_url")

    webhook_url = ENV_WEBHOOK or db_webhook

    if not webhook_url or ("/api/webhooks/" not in webhook_url):
        print("Huom: Discord Webhook URL puuttuu tai ei ole kelvollinen!")
        return

    print("🔍 Etsitään työpaikkoja Duunitorista hakusanoilla:")
    print(", ".join(SEARCH_TERMS))
    
    # 1. Haetaan Duunitorista kaikilla hakusanoilla
    all_jobs = []
    seen_in_current_run = set()

    for term in SEARCH_TERMS:
        duuni_results = fetch_duunitori_jobs(term)
        for job in duuni_results:
            if job["link"] not in seen_in_current_run:
                seen_in_current_run.add(job["link"])
                all_jobs.append(job)

    # 2. Haetaan ITduunit.fi -sivustolta
    it_jobs = fetch_itduunit_jobs()
    for job in it_jobs:
        if job["link"] not in seen_in_current_run:
            seen_in_current_run.add(job["link"])
            all_jobs.append(job)
            
    print(f"Löydettiin yhteensä {len(all_jobs)} uniikkia ilmoitusta. Tarkistetaan tietokannasta...")

    # 3. Tarkistetaan kannasta ja lähetetään vain uudet
    new_count = 0
    for job in all_jobs:
        job_link = job["link"]
        
        existing = supabase.table("seen_jobs").select("id").eq("job_url", job_link).eq("webhook_url", webhook_url).execute()
        if existing.data:
            continue

        send_discord_alert(webhook_url, job)
        new_count += 1
        
        supabase.table("seen_jobs").insert({
            "job_url": job_link,
            "webhook_url": webhook_url
        }).execute()

    print(f"Haku valmis. Uusia ilmoituksia lähetetty Discordiin: {new_count}")


if __name__ == "__main__":
    run_watchdog()
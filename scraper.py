import os
import re
import json
import html
import requests
from supabase import create_client, Client
from dotenv import load_dotenv
from pywebpush import webpush, WebPushException

load_dotenv(dotenv_path=".env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_CLAIMS = {"sub": "mailto:tyopaikkavahti@example.com"}

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Virhe: Supabase-avaimet puuttuvat ympäristömuuttujista.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def send_push_notification(title, body, url="/"):
    if not VAPID_PRIVATE_KEY:
        print("VAPID_PRIVATE_KEY puuttuu, push-ilmoitusta ei lähetetä.")
        return

    res = supabase.from_("push_subscriptions").select("*").execute()
    subs = res.data or []

    if not subs:
        print("Ei aktiivisia push-tilaajia tietokannassa.")
        return

    payload = json.dumps({"title": title, "body": body, "url": url})

    for item in subs:
        sub_info = item.get("subscription")
        sub_id = item.get("id")
        if not sub_info:
            continue

        try:
            webpush(
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS,
            )
            print("✅ Push-ilmoitus lähetetty onnistuneesti laitteeseen!")
        except WebPushException as ex:
            print(f"Push-lähetysvirhe: {ex}")
            if "410" in str(ex) or "404" in str(ex):
                if sub_id:
                    supabase.from_("push_subscriptions").delete().eq(
                        "id", sub_id
                    ).execute()
                    print(f"Poistettu vanhentunut tilaus kannasta (ID: {sub_id})")


def fetch_and_process_jobs():
    print("\n--- Aloitetaan työpaikkahaku ja push-hälytykset ---")

    # Haetaan Duunitorin hakusivu
    search_url = "https://duunitori.fi/tyopaikat?haku=ohjelmistokehitt%C3%A4j%C3%A4"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    try:
        resp = requests.get(search_url, headers=headers, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"Virhe Duunitorin haussa: {e}")
        return

    # Etsitään työpaikkalinkit ja sisällöt HTML-rakenteesta
    cards = re.findall(
        r'<a\s+[^>]*href="(/tyopaikat/tyo/[^"]+)"[^>]*>(.*?)</a>', resp.text, re.DOTALL
    )

    new_jobs = []
    seen_urls = set()

    for path, content in cards:
        full_url = f"https://duunitori.fi{path}"
        if full_url in seen_urls:
            continue
        seen_urls.add(full_url)

        # Otsikko
        title_match = re.search(
            r'class="[^"]*job-box__title[^"]*"[^>]*>(.*?)</h3>', content, re.DOTALL
        )
        if not title_match:
            title_match = re.search(r"<h3[^>]*>(.*?)</h3>", content, re.DOTALL)

        raw_title = title_match.group(1) if title_match else ""
        title = html.unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
        if not title:
            continue

        # Yritys
        company_match = re.search(
            r'class="[^"]*job-box__company[^"]*"[^>]*>(.*?)</span>', content, re.DOTALL
        )
        raw_company = company_match.group(1) if company_match else ""
        company = (
            html.unescape(re.sub(r"<[^>]+>", "", raw_company)).strip()
            or "Yritys ei tiedossa"
        )

        # Sijainti
        loc_match = re.search(
            r'class="[^"]*job-box__location[^"]*"[^>]*>(.*?)</span>', content, re.DOTALL
        )
        raw_loc = loc_match.group(1) if loc_match else ""
        location = (
            html.unescape(re.sub(r"<[^>]+>", "", raw_loc)).strip() or "Suomi / Etä"
        )

        text_content = f"{title} {location}".lower()

        # Pisteytys
        score = 0
        matched_skills = []
        keywords = {
            "React": ["react", "next"],
            "TypeScript": ["typescript", "ts"],
            "Node.js": ["node", "express"],
            "Python": ["python", "django", "fastapi"],
            "Fullstack": ["fullstack", "full stack", "web", "kehittäjä", "developer"],
        }

        for skill, terms in keywords.items():
            if any(t in text_content for t in terms):
                score += 20
                matched_skills.append(skill)

        if score > 100:
            score = 100

        # Tarkistus ja tallennus tietokantaan
        exists = (
            supabase.from_("seen_jobs").select("id").eq("job_url", full_url).execute()
        )
        if not exists.data:
            job_data = {
                "title": title,
                "company": company,
                "location": location,
                "job_url": full_url,
                "match_score": score,
                "matched_skills": matched_skills,
            }
            res = supabase.from_("seen_jobs").insert(job_data).execute()
            if res.data:
                new_jobs.append(job_data)

    print(f"Haku valmis. Uusia ilmoituksia löydetty ja viety kantaan: {len(new_jobs)}")

    # Lähetetään push-ilmoitus
    if len(new_jobs) == 1:
        j = new_jobs[0]
        send_push_notification(
            title=f"🎯 Uusi työpaikka: {j['title']}",
            body=f"🏢 {j['company']} ({j['location']}) • Osuvuus: {j['match_score']}%",
            url=j["job_url"],
        )
    elif len(new_jobs) > 1:
        best_match = max(new_jobs, key=lambda x: x.get("match_score", 0))
        send_push_notification(
            title=f"🎯 Löytyi {len(new_jobs)} uutta työpaikkaa!",
            body=f"Paras osuma: {best_match['title']} ({best_match['match_score']}%) - {best_match['company']}",
            url="/",
        )


if __name__ == "__main__":
    fetch_and_process_jobs()

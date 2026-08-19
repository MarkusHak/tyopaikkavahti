import os
import re
import json
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
            # Poistetaan vanhentunut tilaus tietokannasta
            if "410" in str(ex) or "404" in str(ex):
                if sub_id:
                    supabase.from_("push_subscriptions").delete().eq(
                        "id", sub_id
                    ).execute()
                    print(f"Poistettu vanhentunut tilaus kannasta (ID: {sub_id})")


def fetch_and_process_jobs():
    print("\n--- Aloitetaan työpaikkahaku ja push-hälytykset ---")

    # Duunitorin virallinen IT- ja ohjelmistoalan RSS-syöte
    feed_url = (
        "https://duunitori.fi/tyopaikat/ammattiala/it-ohjelmistot-tietoliikenne/rss.xml"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(feed_url, headers=headers, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"Virhe haettaessa Duunitorin syötettä: {e}")
        return

    # Etsitään ilmoitukset regexillä
    items = re.findall(r"<item>(.*?)</item>", resp.text, re.DOTALL)

    new_jobs = []
    for item in items:
        title_match = re.search(r"<title>(.*?)</title>", item)
        link_match = re.search(r"<link>(.*?)</link>", item)
        desc_match = re.search(r"<description>(.*?)</description>", item)

        raw_title = title_match.group(1) if title_match else "Työpaikkailmoitus"
        job_url = link_match.group(1) if link_match else ""
        desc = desc_match.group(1) if desc_match else ""

        # Siistitään CDATA
        raw_title = raw_title.replace("<![CDATA[", "").replace("]]>", "").strip()
        desc = desc.replace("<![CDATA[", "").replace("]]>", "").strip()

        # Erotetaan yritys ja titteli ("Titteli - Yritys" -> erikseen)
        if " - " in raw_title:
            parts = raw_title.split(" - ")
            title = parts[0].strip()
            company = parts[1].strip()
        else:
            title = raw_title
            company = "Yritys ei tiedossa"

        # Tunnistetaan sijainti tekstistä
        location = "Suomi / Etä"
        text_content = f"{title} {desc}".lower()
        if (
            "kuopio" in text_content
            or "pohjois-savo" in text_content
            or "siilinjärvi" in text_content
        ):
            location = "Pohjois-Savo / Kuopio"
        elif "etä" in text_content or "remote" in text_content:
            location = "Etätyö / Remote"

        # Pisteytys
        score = 0
        matched_skills = []
        keywords = {
            "React": ["react", "next.js", "nextjs"],
            "TypeScript": ["typescript", "ts"],
            "Node.js": ["node", "nodejs", "express"],
            "Python": ["python", "django", "fastapi"],
            "Fullstack": ["fullstack", "full stack", "web"],
        }

        for skill, terms in keywords.items():
            if any(t in text_content for t in terms):
                score += 20
                matched_skills.append(skill)

        if score > 100:
            score = 100

        # Tarkistetaan onko työpaikka jo kannassa
        exists = (
            supabase.from_("seen_jobs").select("id").eq("job_url", job_url).execute()
        )
        if not exists.data:
            job_data = {
                "title": title,
                "company": company,
                "location": location,
                "job_url": job_url,
                "match_score": score,
                "matched_skills": matched_skills,
            }
            res = supabase.from_("seen_jobs").insert(job_data).execute()
            if res.data:
                new_jobs.append(job_data)

    print(f"Haku valmis. Uusia ilmoituksia löydetty ja viety kantaan: {len(new_jobs)}")

    # Lähetetään YKSI koottu ilmoitus
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

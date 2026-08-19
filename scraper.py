import json
import os
import time
from dotenv import load_dotenv
from pywebpush import WebPushException, webpush
import requests
from supabase import Client, create_client

load_dotenv(".env.local", override=True)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
VAPID_PRIVATE_KEY = os.getenv(
    "VAPID_PRIVATE_KEY", "TT1k7SFnWz0pDjXNjoiVUlmRylRKfKX9znerC2HrUOU"
)
VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Seurattavat hakusanat kehittäjä- ja juniorirooleille
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
    "sovelluskehittäjä",
]

# Pohjois-Savon kunnat ja avainsanat
POHJOIS_SAVO_MUNICIPALITIES = {
    "kuopio",
    "siilinjärvi",
    "iisalmi",
    "varkaus",
    "lapinlahti",
    "leppävirta",
    "suonenjoki",
    "kiuruvesi",
    "kaavi",
    "keitele",
    "pielavesi",
    "rautalampi",
    "sonkajärvi",
    "tervo",
    "tuusniemi",
    "vesanto",
    "vieremä",
    "pohjois-savo",
}

# Etätyön tunnistussanat
REMOTE_KEYWORDS = [
    "etätyö",
    "etä",
    "remote",
    "hybridi",
    "hybrid",
    "koko suomi",
    "paikkariippumaton",
    "remote work",
    "work from anywhere",
]

# Osaamisprofiilin pisteytys
SKILL_WEIGHTS = {
    "react": 15,
    "next.js": 15,
    "nextjs": 15,
    "typescript": 15,
    "javascript": 12,
    "python": 15,
    "node.js": 12,
    "nodejs": 12,
    "tailwind": 8,
    "docker": 8,
    "supabase": 8,
    "sql": 8,
    "git": 6,
    "rest": 6,
    "api": 6,
    "linux": 6,
    "fullstack": 10,
    "frontend": 10,
    "backend": 10,
    "junior": 10,
    "trainee": 10,
}


def calculate_match_score(job_data: dict) -> tuple[int, list[str]]:
    """Laskee työpaikalle yhteensopivuuspisteet (0-100 %) ja palauttaa löydetyt taidot."""
    text_to_scan = (
        f"{job_data.get('title', '')} {job_data.get('description', '')}".lower()
    )

    matched_skills = set()
    total_score = 0

    for skill, points in SKILL_WEIGHTS.items():
        if skill in text_to_scan:
            display_name = (
                "Next.js"
                if skill in ["next.js", "nextjs"]
                else (
                    "Node.js" if skill in ["node.js", "nodejs"] else skill.capitalize()
                )
            )
            matched_skills.add(display_name)
            total_score += points

    percentage = min(100, int((total_score / 50) * 100))
    return percentage, sorted(list(matched_skills))


def is_job_matching_location_criteria(job_data: dict) -> tuple[bool, bool]:
    """Tarkistaa sijainnin. Palauttaa (hyväksytäänkö, onko_paikallinen)."""
    location = str(job_data.get("location", "")).lower()
    title = str(job_data.get("title", "")).lower()
    description = str(job_data.get("description", "")).lower()
    combined_text = f"{location} {title} {description}"

    for place in POHJOIS_SAVO_MUNICIPALITIES:
        if place in location or place in title:
            return True, True

    for remote_term in REMOTE_KEYWORDS:
        if remote_term in combined_text:
            return True, False

    return False, False


def fetch_duunitori_jobs(query: str):
    """Hakee työpaikat Duunitorin rajapinnasta ja poimii yrityksen nimen luotettavasti."""
    url = "https://duunitori.fi/api/v1/jobentries"
    params = {"search": query, "format": "json"}
    results = []

    try:
        res = requests.get(url, params=params, headers=HEADERS, timeout=10)
        if res.status_code == 200:
            items = res.json().get("results", [])
            for item in items[:20]:
                slug = item.get("slug", "")
                link = (
                    f"https://duunitori.fi/tyopaikat/tyo/{slug}"
                    if slug
                    else "https://duunitori.fi"
                )

                # Nappaa yrityksen nimi kaikista Duunitorin mahdollisista kentistä
                company_obj = item.get("company")
                company_name = "Ei ilmoitettu"

                if isinstance(company_obj, dict):
                    company_name = (
                        company_obj.get("name")
                        or company_obj.get("title")
                        or "Ei ilmoitettu"
                    )
                elif isinstance(company_obj, str) and company_obj.strip():
                    company_name = company_obj
                else:
                    # Varavaihtoehdot suoraan juuresta
                    company_name = (
                        item.get("company_name")
                        or item.get("employer_name")
                        or item.get("organization_name")
                        or "Ei ilmoitettu"
                    )

                # Poimitaan sijainti
                location = (
                    item.get("municipality_name")
                    or item.get("location_name")
                    or (
                        item.get("location")
                        if isinstance(item.get("location"), str)
                        else None
                    )
                    or "Ei määritelty / Etätyö"
                )

                results.append(
                    {
                        "source": f"Duunitori / {query}",
                        "title": item.get("heading")
                        or item.get("title")
                        or "Työpaikkailmoitus",
                        "company": company_name,
                        "location": location,
                        "description": item.get("descr", "") or item.get("snippet", ""),
                        "link": link,
                    }
                )
    except Exception as e:
        print(f"Duunitori-virhe hakusanalla '{query}': {e}")
    return results


def send_push_notification(job: dict, score: int, is_local: bool):
    """Lähettää push-ilmoituksen puhelimeen Web Push -rajapinnan kautta."""
    res = supabase.table("push_subscriptions").select("id, subscription").execute()
    subscriptions = res.data or []

    if not subscriptions:
        return

    location_tag = "📍 Pohjois-Savo" if is_local else "🌐 Etätyö"
    payload = json.dumps(
        {
            "title": f"🎯 Osuma {score}%: {job['title']}",
            "body": f"🏢 {job['company']} • {location_tag}",
            "url": job["link"],
        }
    )

    for item in subscriptions:
        try:
            webpush(
                subscription_info=item["subscription"],
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS,
            )
            print(f"-> Push-ilmoitus lähetetty puhelimeen: {job['title']}")
        except WebPushException as ex:
            print(f"Push-lähetysvirhe: {ex}")
            # Jos tilaus on vanhentunut tai poistettu selaimesta, siivotaan se pois kannasta
            if ex.response and ex.response.status_code in [404, 410]:
                supabase.table("push_subscriptions").delete().eq(
                    "id", item["id"]
                ).execute()


def run_watchdog():
    print("\n--- Aloitetaan työpaikkahaku ja push-hälytykset ---")

    all_jobs = []
    seen_in_current_run = set()

    for term in SEARCH_TERMS:
        duuni_results = fetch_duunitori_jobs(term)
        for job in duuni_results:
            if job["link"] not in seen_in_current_run:
                seen_in_current_run.add(job["link"])

                is_match, is_local = is_job_matching_location_criteria(job)
                if is_match:
                    score, skills = calculate_match_score(job)
                    if is_local or score >= 25:
                        all_jobs.append((job, score, skills, is_local))

    print(
        f"Löydettiin {len(all_jobs)} kriteerit täyttävää paikkaa. Tarkistetaan uudet tietokannasta..."
    )

    new_count = 0
    for job, score, skills, is_local in all_jobs:
        job_link = job["link"]

        existing = (
            supabase.table("seen_jobs").select("id").eq("job_url", job_link).execute()
        )

        if existing.data:
            continue

        # 1. Lähetetään Push-ilmoitus suoraan puhelimeen
        send_push_notification(job, score, is_local)
        new_count += 1

        # 2. Tallennetaan työpaikka Supabaseen (näkyy heti puhelimen etusivulla)
        supabase.table("seen_jobs").insert(
            {
                "job_url": job_link,
                "webhook_url": "push",
                "title": job["title"],
                "company": job["company"],
                "location": job["location"],
                "match_score": score,
                "matched_skills": skills,
            }
        ).execute()

    print(f"Haku valmis. Uusia ilmoituksia löydetty ja viety kantaan: {new_count}")


if __name__ == "__main__":
    run_watchdog()

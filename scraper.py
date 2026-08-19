import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(".env.local", override=True)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
ENV_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL")

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
            # Siistitään nimikkeet esitystä varten
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

    # 1. Pohjois-Savo
    for place in POHJOIS_SAVO_MUNICIPALITIES:
        if place in location or place in title:
            return True, True

    # 2. Etätyöt muualta Suomesta
    for remote_term in REMOTE_KEYWORDS:
        if remote_term in combined_text:
            return True, False

    return False, False


def fetch_duunitori_jobs(query: str):
    """Hakee työpaikat Duunitorin rajapinnasta."""
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
                company_obj = item.get("company") or {}
                company = (
                    company_obj.get("name")
                    if isinstance(company_obj, dict)
                    else "Ei ilmoitettu"
                )

                results.append(
                    {
                        "source": f"Duunitori / {query}",
                        "title": item.get("heading", "Työpaikkailmoitus"),
                        "company": company,
                        "location": item.get("municipality_name")
                        or "Ei määritelty / Etätyö",
                        "description": item.get("descr", "") or item.get("snippet", ""),
                        "link": link,
                    }
                )
    except Exception as e:
        print(f"Duunitori-virhe hakusanalla '{query}': {e}")
    return results


def send_discord_alert(
    webhook_url: str, job: dict, score: int, matched_skills: list[str], is_local: bool
):
    location_badge = "📍 POHJOIS-SAVO" if is_local else "🌐 ETÄTYÖ / HYBRIDI"

    if score >= 70:
        color = 5763719  # Vihreä
        stars = "⭐⭐⭐⭐⭐"
    elif score >= 40:
        color = 16776960  # Keltainen
        stars = "⭐⭐⭐"
    else:
        color = 3447003  # Sininen
        stars = "⭐"

    skills_str = (
        ", ".join(matched_skills) if matched_skills else "Yleinen kehittäjätehtävä"
    )

    payload = {
        "username": "Työpaikkavahti",
        "embeds": [
            {
                "title": f"🎯 [{location_badge}] {job['title']}",
                "description": f"**Työnantaja:** {job['company']}\n**Sijainti:** {job['location']}",
                "color": color,
                "fields": [
                    {
                        "name": f"Yhteensopivuus: {score}% {stars}",
                        "value": f"**Osumat profiiliin:** {skills_str}",
                        "inline": False,
                    },
                    {
                        "name": "Linkki ilmoitukseen",
                        "value": f"[Avaa työpaikkailmoitus tästä]({job['link']})",
                        "inline": False,
                    },
                ],
                "footer": {"text": f"Lähde: {job['source']}"},
            }
        ],
    }

    while True:
        res = requests.post(webhook_url, json=payload)
        if res.status_code in [200, 204]:
            print(
                f"-> Lähetetty Discordiin ({score}% | {location_badge}): {job['title']}"
            )
            time.sleep(1)
            break
        elif res.status_code == 429:
            retry_after = res.json().get("retry_after", 1.5)
            time.sleep(retry_after + 0.5)
        else:
            print(f"Discord-virhe ({res.status_code}): {res.text}")
            break


def run_watchdog():
    print("\n--- Aloitetaan työpaikkahaku ja pisteytys ---")
    profiles_res = (
        supabase.table("profiles")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    db_webhook = None
    if profiles_res.data:
        profile = profiles_res.data[0]
        db_webhook = profile.get("discord_webhook_url")

    webhook_url = ENV_WEBHOOK or db_webhook

    if not webhook_url or ("/api/webhooks/" not in webhook_url):
        print("Huom: Discord Webhook URL puuttuu tai ei ole kelvollinen!")
        return

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

                    # Suodatus: Pohjois-Savo aina mukaan, etätöissä vähintään 25 % osuma
                    if is_local or score >= 25:
                        all_jobs.append((job, score, skills, is_local))

    print(
        f"Löydettiin {len(all_jobs)} kriteerit täyttävää paikkaa. Tarkistetaan uudet tietokannasta..."
    )

    new_count = 0
    for job, score, skills, is_local in all_jobs:
        job_link = job["link"]

        existing = (
            supabase.table("seen_jobs")
            .select("id")
            .eq("job_url", job_link)
            .eq("webhook_url", webhook_url)
            .execute()
        )
        if existing.data:
            continue

        send_discord_alert(webhook_url, job, score, skills, is_local)
        new_count += 1

        supabase.table("seen_jobs").insert(
            {
                "job_url": job_link,
                "webhook_url": webhook_url,
                "title": job["title"],
                "company": job["company"],
                "location": job["location"],
                "match_score": score,
                "matched_skills": skills,
            }
        ).execute()

    print(f"Haku valmis. Uusia ilmoituksia lähetetty Discordiin: {new_count}")


if __name__ == "__main__":
    run_watchdog()

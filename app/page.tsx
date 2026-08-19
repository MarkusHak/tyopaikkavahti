'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  job_url: string;
  match_score: number;
  matched_skills: string[];
  created_at: string;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high_match' | 'local'>('all');
  const [subscribing, setSubscribing] = useState(false);

  // Hakemus-modalin tilat
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [generatedLetter, setGeneratedLetter] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('seen_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setJobs(data);
    }
    setLoading(false);
  }

  async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push-ilmoitukset eivät ole tuettuja tällä selaimella.');
      return;
    }

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      alert('VAPID-avain puuttuu ympäristömuuttujista (NEXT_PUBLIC_VAPID_PUBLIC_KEY).');
      return;
    }

    setSubscribing(true);
    try {
      const register = await navigator.serviceWorker.register('/sw.js');
      const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const { error } = await supabase
        .from('push_subscriptions')
        .insert([{ subscription }]);

      if (error) throw error;
      alert('🔔 Ilmoitukset aktivoitu puhelimeen onnistuneesti!');
    } catch (err: any) {
      console.error(err);
      alert(`Ilmoitusten aktivointi epäonnistui: ${err.message || err}`);
    } finally {
      setSubscribing(false);
    }
  }

  async function handleGenerateApplication(job: Job) {
    setSelectedJob(job);
    setIsGenerating(true);
    setGeneratedLetter('');
    setCopied(false);

    try {
      const res = await fetch('/api/generate-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.title,
          company: job.company,
          location: job.location,
          matchedSkills: job.matched_skills,
          jobUrl: job.job_url,
        }),
      });

      const data = await res.json();
      setGeneratedLetter(data.applicationText || 'Hakemuksen luonti epäonnistui.');
    } catch {
      setGeneratedLetter('Verkkovirhe hakemusta luotaessa.');
    } finally {
      setIsGenerating(false);
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'high_match') return (job.match_score || 0) >= 50;
    if (filter === 'local') {
      const loc = (job.location || '').toLowerCase();
      return loc.includes('savo') || loc.includes('kuopio') || loc.includes('siilinjärvi') || loc.includes('iisalmi');
    }
    return true;
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 pb-20 max-w-md mx-auto relative">
      {/* Yläpalkki */}
      <header className="flex justify-between items-center py-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">🎯 Työpaikkavahti</h1>
          <p className="text-xs text-slate-400">Löydetyt työpaikat ja osumat</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={subscribeToPush}
            disabled={subscribing}
            title="Ota ilmoitukset käyttöön"
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-200 active:scale-95 transition disabled:opacity-50"
          >
            🔔
          </button>
          <button
            onClick={fetchJobs}
            title="Päivitä lista"
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-200 active:scale-95 transition"
          >
            🔄
          </button>
        </div>
      </header>

      {/* Suodattimet */}
      <div className="flex gap-2 my-4 overflow-x-auto py-1">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
            filter === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Kaikki ({jobs.length})
        </button>
        <button
          onClick={() => setFilter('high_match')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
            filter === 'high_match' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Parhaat osumat (≥50%)
        </button>
        <button
          onClick={() => setFilter('local')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
            filter === 'local' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Pohjois-Savo 📍
        </button>
      </div>

      {/* Työpaikkalistaus */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Ladataan ilmoituksia...</div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Ei ilmoituksia valitulla rajauksella.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => {
            const score = job.match_score || 0;
            const badgeColor =
              score >= 70
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : score >= 40
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

            return (
              <div
                key={job.id || job.job_url}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition"
              >
                <div className="flex justify-between items-start gap-2 mb-1">
                  <h2 className="font-semibold text-sm text-slate-100 line-clamp-2">
                    {job.title || 'Työpaikkailmoitus'}
                  </h2>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-md font-bold border shrink-0 ${badgeColor}`}
                  >
                    {score}%
                  </span>
                </div>

                <p className="text-xs text-slate-400 mb-2">
                  🏢 {job.company || 'Yritys ei tiedossa'} • 📍 {job.location || 'Suomi / Etä'}
                </p>

                {job.matched_skills && job.matched_skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {job.matched_skills.map((skill, i) => (
                      <span
                        key={i}
                        className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}

                {/* Toimintopainikkeet */}
                <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800/60">
                  <a
                    href={job.job_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg active:scale-98 transition"
                  >
                    Avaa ilmoitus ↗
                  </a>
                  <button
                    onClick={() => handleGenerateApplication(job)}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg shadow-sm active:scale-98 transition"
                  >
                    ✨ Luo hakemus
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hakemus-modal puhelimen ruudulle */}
      {selectedJob && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-5 shadow-2xl animate-in slide-in-from-bottom">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold text-base text-white">✨ Hakemusluonnos</h3>
                <p className="text-xs text-slate-400">{selectedJob.title} • {selectedJob.company}</p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-slate-400 hover:text-white p-1 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto my-3 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs sm:text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-slate-400">Tekoäly luo hakemuskirjettä...</p>
                </div>
              ) : (
                generatedLetter
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={copyToClipboard}
                disabled={isGenerating || !generatedLetter}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition active:scale-98"
              >
                {copied ? '✅ Kopioitu!' : '📋 Kopioi hakemus'}
              </button>
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
              >
                Sulje
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
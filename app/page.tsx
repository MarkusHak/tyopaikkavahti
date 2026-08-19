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

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high_match' | 'local'>('all');

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

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'high_match') return (job.match_score || 0) >= 50;
    if (filter === 'local') {
      const loc = (job.location || '').toLowerCase();
      return loc.includes('savo') || loc.includes('kuopio') || loc.includes('siilinjärvi') || loc.includes('iisalmi');
    }
    return true;
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 pb-20 max-w-md mx-auto">
      {/* Yläpalkki */}
      <header className="flex justify-between items-center py-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">🎯 Työpaikkavahti</h1>
          <p className="text-xs text-slate-400">Löydetyt työpaikat ja osumat</p>
        </div>
        <button
          onClick={fetchJobs}
          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-200 active:scale-95 transition"
        >
          🔄
        </button>
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

      {/* Työpaikkalista */}
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

                <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800/60">
                  <a
                    href={job.job_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-center py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg active:scale-98 transition"
                  >
                    Avaa ilmoitus ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
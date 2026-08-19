'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// 👉 VAIHDA OMA SALAINEN PIN-KOODISI TÄHÄN:
const CORRECT_PIN = '1234';

// Kuinka monta työpaikkaa näytetään yhdellä sivulla
const ITEMS_PER_PAGE = 10;

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  job_url: string;
  match_score?: number;
  matched_skills?: string[];
  created_at: string;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const [activeTab, setActiveTab] = useState<'jobs' | 'settings'>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'high_match' | 'local'>('all');

  // Sivutuksen tila
  const [currentPage, setCurrentPage] = useState(1);

  // Push-tilat
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  // Asetuslomake
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [formData, setFormData] = useState({
    discord_webhook_url: '',
    skills: 'React, TypeScript, Node.js, Python',
    role_preference: 'Fullstack Developer',
    location_preference: 'Pohjois-Savo',
    remote_only: true,
  });

  useEffect(() => {
    const savedPin = localStorage.getItem('app_pin_auth');
    if (savedPin === CORRECT_PIN) {
      setIsAuthenticated(true);
      initApp();
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const initApp = () => {
    fetchJobs();
    loadSavedProfile();
    checkPushSubscription();
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === CORRECT_PIN) {
      localStorage.setItem('app_pin_auth', CORRECT_PIN);
      setIsAuthenticated(true);
      setPinError(false);
      initApp();
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('app_pin_auth');
    setIsAuthenticated(false);
    setPinInput('');
  };

  async function checkPushSubscription() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) setPushSubscribed(true);
      } catch (err) {
        console.error('Push-tarkistus epäonnistui:', err);
      }
    }
  }

  async function subscribeToPush() {
    setPushLoading(true);
    try {
      if (!('serviceWorker' in navigator)) {
        alert('Selaimesi ei tue Service Worker -palvelua.');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Ilmoituslupa hylättiin selaimessa.');
        return;
      }

      const vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDNTmxst9GytwdBQao5KoQ0mQxDRqUKVUph3dDR7w46Q';
      
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const { error } = await supabase.from('push_subscriptions').insert([
        { subscription: sub.toJSON() },
      ]);

      if (error && !error.message.includes('duplicate')) throw error;

      setPushSubscribed(true);
      alert('🔔 Hälytykset aktivoitu puhelimeen!');
    } catch (err: any) {
      console.error(err);
      alert(`Virhe ilmoitusten tilauksessa: ${err.message}`);
    } finally {
      setPushLoading(false);
    }
  }

  async function fetchJobs() {
    setLoadingJobs(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('seen_jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMessage(`Tietokantavirhe: ${error.message}`);
      } else if (data) {
        setJobs(data);
        setCurrentPage(1); // Nollataan sivu haun yhteydessä
      }
    } catch (err: any) {
      setErrorMessage(`Yhteysvirhe: ${err.message || err}`);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function loadSavedProfile() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !error) {
        setFormData({
          discord_webhook_url: data.discord_webhook_url || '',
          skills: data.skills || '',
          role_preference: data.role_preference || '',
          location_preference: data.location_preference || '',
          remote_only: Boolean(data.remote_only),
        });
      }
    } catch (err) {
      console.error('Profiilin haku epäonnistui:', err);
    }
  }

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMessage(null);

    try {
      const { error } = await supabase.from('profiles').insert([
        {
          discord_webhook_url: formData.discord_webhook_url,
          skills: formData.skills,
          role_preference: formData.role_preference,
          location_preference: formData.location_preference,
          remote_only: formData.remote_only,
        },
      ]);

      if (error) throw error;
      setSettingsMessage({ text: 'Asetukset tallennettu!', type: 'success' });
    } catch (err: any) {
      setSettingsMessage({ text: `Tallennus epäonnistui: ${err.message}`, type: 'error' });
    } finally {
      setSavingSettings(false);
    }
  };

  // Suodatus
  const filteredJobs = jobs.filter((job) => {
    if (filter === 'high_match') return (job.match_score || 0) >= 50;
    if (filter === 'local') {
      const loc = (job.location || '').toLowerCase();
      return loc.includes('savo') || loc.includes('kuopio') || loc.includes('siilinjärvi') || loc.includes('iisalmi');
    }
    return true;
  });

  // Sivutuksen laskenta
  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedJobs = filteredJobs.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleFilterChange = (newFilter: 'all' | 'high_match' | 'local') => {
    setFilter(newFilter);
    setCurrentPage(1); // Siirrytään 1. sivulle, kun suodatin vaihtuu
  };

  // Ladataan tilaa
  if (isAuthenticated === null) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-sm">Ladataan...</div>;
  }

  // --- PIN-LUKITUSRUUTU ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="text-lg font-bold text-white mb-1">Työpaikkavahti</h2>
          <p className="text-xs text-slate-400 mb-6">Syötä PIN-koodi avataksesi sovelluksen</p>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                setPinError(false);
              }}
              placeholder="••••"
              autoFocus
              className={`w-36 mx-auto text-center text-2xl tracking-[0.3em] font-bold py-3 bg-slate-950 border rounded-xl focus:outline-none transition ${
                pinError ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-white focus:border-blue-500'
              }`}
            />

            {pinError && (
              <p className="text-xs text-rose-400 font-medium animate-pulse">Väärä PIN-koodi!</p>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-semibold rounded-xl text-sm transition shadow-lg"
            >
              Avaa lukitus 🔓
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- PÄÄSOVELLUS ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-md mx-auto relative pb-20">
      
      {/* Yläpalkki */}
      <header className="flex justify-between items-center p-4 border-b border-slate-800 sticky top-0 bg-slate-950/90 backdrop-blur z-20">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            {activeTab === 'jobs' ? '🎯 Työpaikkavahti' : '⚙️ Asetukset'}
          </h1>
          <p className="text-xs text-slate-400">
            {activeTab === 'jobs' ? 'Löydetyt työpaikat ja osumat' : 'Hälytykset ja hakukriteerit'}
          </p>
        </div>
        {activeTab === 'jobs' && (
          <button
            onClick={fetchJobs}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-200 active:scale-95 transition"
          >
            🔄
          </button>
        )}
      </header>

      {/* Päänäkymä */}
      <main className="p-4 flex-1">
        {activeTab === 'jobs' && (
          <div>
            {errorMessage && (
              <div className="p-3 mb-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs">
                ⚠️ {errorMessage}
              </div>
            )}

            {/* Suodattimet */}
            <div className="flex gap-2 mb-4 overflow-x-auto py-1">
              <button
                onClick={() => handleFilterChange('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  filter === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Kaikki ({jobs.length})
              </button>
              <button
                onClick={() => handleFilterChange('high_match')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  filter === 'high_match' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Parhaat osumat (≥50%)
              </button>
              <button
                onClick={() => handleFilterChange('local')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  filter === 'local' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Pohjois-Savo 📍
              </button>
            </div>

            {/* Työpaikkalista */}
            {loadingJobs ? (
              <div className="text-center py-16 text-slate-400 text-sm">Ladataan ilmoituksia...</div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-sm">
                Ei ilmoituksia valitulla rajauksella.
              </div>
            ) : (
              <div className="space-y-3">
                {paginatedJobs.map((job) => {
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
                        {job.match_score !== undefined && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-md font-bold border shrink-0 ${badgeColor}`}
                          >
                            {score}%
                          </span>
                        )}
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

                {/* SIVUTUSOHJAIMET (Pagination) */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 pb-2 border-t border-slate-800/80">
                    <button
                      onClick={() => {
                        setCurrentPage((prev) => Math.max(prev - 1, 1));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-lg text-xs font-medium text-slate-200 transition"
                    >
                      ← Edellinen
                    </button>

                    <span className="text-xs font-medium text-slate-400">
                      Sivu <span className="text-white font-bold">{currentPage}</span> / {totalPages}
                    </span>

                    <button
                      onClick={() => {
                        setCurrentPage((prev) => Math.min(prev + 1, totalPages));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-lg text-xs font-medium text-slate-200 transition"
                    >
                      Seuraava →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* NÄKYMÄ 2: ASETUKSET */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            {/* PUSH-HÄLYTYKSET */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-white mb-1">📱 Puhelimen hälytykset</h3>
              <p className="text-xs text-slate-400 mb-3">
                Saat ilmoituksen heti, kun kriteerejäsi vastaava uusi työpaikka löytyy.
              </p>
              
              <button
                onClick={subscribeToPush}
                disabled={pushLoading || pushSubscribed}
                className={`w-full py-2.5 rounded-lg text-xs font-semibold transition active:scale-98 ${
                  pushSubscribed
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg'
                }`}
              >
                {pushLoading
                  ? 'Aktivoidaan...'
                  : pushSubscribed
                  ? '✅ Hälytykset aktivoitu tähän laitteeseen'
                  : '🔔 Ota ilmoitukset käyttöön puhelimeen'}
              </button>
            </div>

            {/* HAKUKRITEERIT */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-white mb-3">🎯 Hakukriteerit</h3>
              
              {settingsMessage && (
                <div
                  className={`p-3 mb-4 rounded-lg text-xs ${
                    settingsMessage.type === 'success'
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/60 text-rose-300 border border-rose-800'
                  }`}
                >
                  {settingsMessage.text}
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Discord Webhook URL
                  </label>
                  <input
                    type="text"
                    name="discord_webhook_url"
                    value={formData.discord_webhook_url}
                    onChange={handleFormChange}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rooli / Hakusana
                  </label>
                  <input
                    type="text"
                    name="role_preference"
                    value={formData.role_preference}
                    onChange={handleFormChange}
                    placeholder="esim. Fullstack Developer"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Osaaminen / Avainsanat (pilkulla eroteltuna)
                  </label>
                  <textarea
                    name="skills"
                    value={formData.skills}
                    onChange={handleFormChange}
                    rows={2}
                    placeholder="React, TypeScript, Node.js, Python"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Sijainti
                  </label>
                  <input
                    type="text"
                    name="location_preference"
                    value={formData.location_preference}
                    onChange={handleFormChange}
                    placeholder="Pohjois-Savo / Koko Suomi"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 text-slate-200"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="remote_only_tab"
                    name="remote_only"
                    checked={formData.remote_only}
                    onChange={handleFormChange}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
                  />
                  <label htmlFor="remote_only_tab" className="text-xs text-slate-300">
                    Vain etätyö / etätyömahdollisuus
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded-lg transition-colors text-xs disabled:opacity-50 active:scale-98"
                >
                  {savingSettings ? 'Tallennetaan...' : 'Tallenna kriteerit'}
                </button>
              </form>
            </div>

            {/* LUKITUS / ULOSKIRJAUTUMINEN */}
            <div className="pt-2 text-center">
              <button
                onClick={handleLogout}
                className="text-xs text-rose-400 hover:text-rose-300 py-2 px-4 rounded-lg bg-rose-950/40 border border-rose-900/60"
              >
                🔒 Lukitse sovellus tällä laitteella
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Alavalikko */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur border-t border-slate-800 flex justify-around py-2.5 z-30">
        <button
          onClick={() => setActiveTab('jobs')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'jobs' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-lg">💼</span>
          <span className="text-[11px]">Työpaikat</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'settings' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-lg">⚙️</span>
          <span className="text-[11px]">Asetukset</span>
        </button>
      </nav>
    </div>
  );
}
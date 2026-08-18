'use client';

import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [formData, setFormData] = useState({
    discord_webhook_url: '',
    skills: 'React, TypeScript, Node.js, Python',
    role_preference: 'Fullstack Developer',
    location_preference: 'Pohjois-Savo',
    remote_only: true,
  });

  // Haetaan viimeksi tallennetut asetukset suoraan Supabasesta sivun latautuessa
  useEffect(() => {
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
        console.error('Profiilin nouto epäonnistui:', err);
      } finally {
        setFetching(false);
      }
    }

    loadSavedProfile();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

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

      setMessage({ text: 'Asetukset ja Discord-webhook tallennettu onnistuneesti!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: `Tallennus epäonnistui: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400">Ladataan tallennettuja tietoja...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-8 flex flex-col items-center justify-center">
      <div className="max-w-xl w-full bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
        <h1 className="text-2xl font-bold mb-2 text-white">🤖 Työpaikkavahti</h1>
        <p className="text-slate-400 text-sm mb-6">
          Aseta hakukriteerit ja Discord-kanava ilmoituksia varten. Tiedot säilyvät tallessa.
        </p>

        {message && (
          <div
            className={`p-4 mb-6 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                : 'bg-rose-950/60 text-rose-300 border border-rose-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Discord Webhook URL
            </label>
            <input
              type="text"
              name="discord_webhook_url"
              value={formData.discord_webhook_url}
              onChange={handleChange}
              placeholder="https://discord.com/api/webhooks/..."
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Rooli / Hakusana
            </label>
            <input
              type="text"
              name="role_preference"
              value={formData.role_preference}
              onChange={handleChange}
              placeholder="esim. Fullstack Developer"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Osaaminen / Avainsanat (pilkulla eroteltuna)
            </label>
            <textarea
              name="skills"
              value={formData.skills}
              onChange={handleChange}
              rows={2}
              placeholder="React, TypeScript, Node.js, Python"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Sijainti
            </label>
            <input
              type="text"
              name="location_preference"
              value={formData.location_preference}
              onChange={handleChange}
              placeholder="Pohjois-Savo / Koko Suomi"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <input
              type="checkbox"
              id="remote_only"
              name="remote_only"
              checked={formData.remote_only}
              onChange={handleChange}
              className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
            />
            <label htmlFor="remote_only" className="text-sm text-slate-300">
              Vain etätyö / etätyömahdollisuus
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Tallennetaan...' : 'Tallenna asetukset'}
          </button>
        </form>
      </div>
    </main>
  );
}
import React, { useState, FormEvent } from 'react';

const API_URL = 'https://api.urlkit.io';

interface ApiResponse {
  short_url: string;
  original_url: string;
  error?: string;
}

const URLShortener: React.FC = () => {
  const [url, setUrl] = useState('');
  const [expiryDays, setExpiryDays] = useState('365');
  //const [shortUrl, setShortUrl] = useState('');
  const [shortId, setShortId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const getShortUrl = (id: string) => `https://urlkit.io/${id}`;
  //const getRedirectUrl = (id: string) => `${API_URL}/${id}`;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    //setShortUrl('');
    setShortId('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/urls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          expires_in_days: parseInt(expiryDays),
        }),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to shorten URL');
      }

      const id = data.short_url.split('/').pop() || '';
      //setShortUrl(data.short_url);
      setShortId(id);

    } catch (err) {
      console.error('Error shortening URL:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getShortUrl(shortId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-bl from-gray-900 via-black to-gray-800 text-white flex flex-col items-center justify-center p-6 relative">
      <div className="absolute inset-0 bg-gradient-radial from-purple-900 via-black to-gray-900 opacity-75 animate-gradient" />

      <div className="z-10 text-center mb-6">
        <h1 className="text-5xl font-extrabold text-white mb-2 tracking-wide">
          Welcome to the URL Shortener
        </h1>
      </div>

      <div className="z-10 w-full max-w-lg bg-black/80 backdrop-blur-lg rounded-2xl p-8 border border-gray-700 shadow-neon">
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="url"
            placeholder="Enter your long URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="w-full px-4 py-3 bg-gray-800 text-gray-200 placeholder-gray-400 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 hover:scale-105 transition-transform"
          />

          <input
            type="number"
            placeholder="Expiry days (default: 365)"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            min="1"
            max="3650"
            className="w-full px-4 py-3 bg-gray-800 text-gray-200 placeholder-gray-400 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 hover:scale-105 transition-transform"
          />

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 font-bold rounded-lg shadow-lg text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-pink-500 hover:to-purple-500 hover:shadow-purple focus:outline-none ${
              loading ? 'opacity-75 cursor-wait' : 'hover:scale-105 transition-transform'
            }`}
          >
            {loading ? '⏳ Shortening...' : '✨ Shorten URL'}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-500/50 backdrop-blur-lg text-white rounded-lg border border-red-400">
            ⚠️ {error}
          </div>
        )}

        {shortId && (
          <div className="mt-6 p-4 bg-gray-800/50 backdrop-blur-lg border border-gray-600 rounded-lg">
            <div className="flex items-center justify-between gap-2">
              <a
                href={getShortUrl(shortId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 truncate"
              >
                {getShortUrl(shortId)}
              </a>
              <button
                onClick={handleCopy}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-transform transform hover:scale-110"
                type="button"
              >
                📋 Copy
              </button>
            </div>
            {copied && (
              <p className="mt-2 text-sm text-green-400">
                ✅ Copied to clipboard!
              </p>
            )}
          </div>
        )}

        <div className="mt-4 text-sm text-gray-400 text-center">
          {shortId ? '🔗 Share your link!' : '✍️ Enter a URL to get started'}
        </div>
      </div>
    </div>
  );
};

export default URLShortener;
import React, { useState } from 'react';

// API Gateway URL - you can also move this to .env
const API_URL = 'https://ltmz097lv9.execute-api.us-east-1.amazonaws.com/prod';

const URLShortener: React.FC = () => {
    const [url, setUrl] = useState('');
    const [expiryDays, setExpiryDays] = useState('365');
    const [shortUrl, setShortUrl] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setShortUrl('');
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

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to shorten URL');
            }

            // The short_url from the response will already contain the API Gateway domain
            setShortUrl(data.short_url);
            
            // Log success for debugging
            console.log('URL shortened successfully:', data);
        } catch (err) {
            console.error('Error shortening URL:', err);
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shortUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            setError('Failed to copy to clipboard');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl text-blue-600">🔗</span>
                    <h1 className="text-xl font-bold text-gray-900">URL Shortener</h1>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="url"
                        placeholder="Enter your long URL (include https://)"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />

                    <input
                        type="number"
                        placeholder="Expiry days (default: 365)"
                        value={expiryDays}
                        onChange={(e) => setExpiryDays(e.target.value)}
                        min="1"
                        max="3650"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? '⏳ Shortening...' : '✨ Shorten URL'}
                    </button>
                </form>

                {error && (
                    <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">
                        ⚠️ {error}
                    </div>
                )}

                {shortUrl && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between gap-2">
                            <a
                                href={shortUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 truncate"
                            >
                                {shortUrl}
                            </a>
                            <button
                                onClick={handleCopy}
                                className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                                type="button"
                            >
                                📋
                            </button>
                        </div>
                        {copied && (
                            <div className="mt-2 text-sm text-green-600">
                                ✅ Copied to clipboard!
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-4 text-sm text-gray-500 flex justify-between">
                    <span>⏱️ Valid for {expiryDays} days</span>
                    <span>{shortUrl ? '🔗 Share your link!' : '✍️ Enter a URL to get started'}</span>
                </div>
            </div>
        </div>
    );
};

export default URLShortener;
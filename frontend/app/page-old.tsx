'use client';

import { useState } from 'react';
import SearchFilters, { AuctionFilters } from './components/SearchFilters';
import AuctionList from './components/AuctionList';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SearchResult {
  total: number;
  items: any[];
}

type Tab = 'ai' | 'manual';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Add assistant response to chat
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (error: any) {
      console.error('Error:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Desculpe, ocorreu um erro ao processar sua solicitação: ${error.message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = async (filters: AuctionFilters) => {
    setSearchLoading(true);
    setSearchResults(null);

    try {
      const params = new URLSearchParams();
      if (filters.state) params.set('state', filters.state);
      if (filters.city) params.set('city', filters.city);
      if (filters.neighborhood) params.set('neighborhood', filters.neighborhood);
      if (filters.modality) params.set('modality', filters.modality);
      if (filters.minMargin) params.set('minMargin', filters.minMargin.toString());
      if (filters.maxMargin) params.set('maxMargin', filters.maxMargin.toString());
      params.set('limit', '50'); // Show up to 50 results

      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch auctions');
      }

      setSearchResults(data);
    } catch (error: any) {
      console.error('Error:', error);
      setSearchResults({ total: 0, items: [] });
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-off-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="bg-white rounded-lg shadow-xl overflow-hidden border border-medium-gray">
          {/* Header */}
          <div className="bg-steel-blue text-white p-6">
            <h1 className="text-3xl font-bold">Leilões Caixa</h1>
            <p className="text-off-white/90 mt-2">
              Encontre imóveis em leilão da Caixa Econômica Federal
            </p>
          </div>

          {/* Tabs */}
          <div className="border-b border-medium-gray bg-warm-beige">
            <div className="flex">
              <button
                onClick={() => setActiveTab('ai')}
                className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                  activeTab === 'ai'
                    ? 'text-steel-blue border-b-2 border-steel-blue bg-white'
                    : 'text-cool-gray hover:text-dark-charcoal hover:bg-white/50'
                }`}
              >
                🤖 Busca com IA
              </button>
              <button
                onClick={() => setActiveTab('manual')}
                className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                  activeTab === 'manual'
                    ? 'text-steel-blue border-b-2 border-steel-blue bg-white'
                    : 'text-cool-gray hover:text-dark-charcoal hover:bg-white/50'
                }`}
              >
                🔍 Busca Manual
              </button>
            </div>
          </div>

          {/* AI Chat Tab */}
          {activeTab === 'ai' && (
            <>
              {/* Chat Messages */}
              <div className="h-[500px] overflow-y-auto p-6 space-y-4 bg-off-white">
                {messages.length === 0 ? (
                  <div className="text-center text-cool-gray mt-20">
                    <svg
                      className="w-16 h-16 mx-auto mb-4 text-concrete"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                    <p className="text-lg font-medium text-dark-charcoal">Comece uma conversa!</p>
                    <p className="text-sm mt-2">
                      Pergunte sobre leilões por estado, cidade, bairro ou faixa de preço.
                    </p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 ${
                          message.role === 'user'
                            ? 'bg-steel-blue text-white'
                            : 'bg-warm-beige text-dark-charcoal border border-medium-gray'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      </div>
                    </div>
                  ))
                )}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-warm-beige border border-medium-gray rounded-lg p-4">
                      <div className="flex space-x-2">
                        <div className="w-2 h-2 bg-steel-blue rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-steel-blue rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-steel-blue rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Form */}
              <div className="border-t border-medium-gray p-4 bg-warm-beige">
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Em quais leilões você está interessado?"
                    className="flex-1 rounded-lg border border-medium-gray px-4 py-3 focus:outline-none focus:ring-2 focus:ring-steel-blue focus:border-transparent bg-white text-dark-charcoal placeholder-concrete"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="bg-steel-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-dark-charcoal focus:outline-none focus:ring-2 focus:ring-steel-blue focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Enviando...' : 'Enviar'}
                  </button>
                </form>
              </div>
            </>
          )}

          {/* Manual Search Tab */}
          {activeTab === 'manual' && (
            <div className="grid md:grid-cols-3 gap-6 p-6 bg-off-white">
              {/* Filters Sidebar */}
              <div className="md:col-span-1">
                <div className="sticky top-6">
                  <h2 className="text-lg font-semibold text-dark-charcoal mb-4">Filtros de Busca</h2>
                  <SearchFilters onSearch={handleManualSearch} isLoading={searchLoading} />
                </div>
              </div>

              {/* Results Area */}
              <div className="md:col-span-2">
                {searchResults === null ? (
                  <div className="text-center py-20 text-cool-gray">
                    <div className="text-5xl mb-4">🔍</div>
                    <p className="text-lg font-medium text-dark-charcoal">Use os filtros ao lado para buscar leilões</p>
                    <p className="text-sm mt-2">Selecione estado, cidade, bairro ou faixa de preço</p>
                  </div>
                ) : (
                  <AuctionList
                    auctions={searchResults.items}
                    total={searchResults.total}
                    isLoading={searchLoading}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Example queries - Only show for AI tab */}
        {activeTab === 'ai' && (
          <div className="mt-6 bg-white rounded-lg shadow border border-medium-gray p-6">
            <h2 className="text-lg font-semibold text-dark-charcoal mb-3">
              Exemplos de perguntas:
            </h2>
            <ul className="space-y-2 text-sm text-cool-gray">
              <li className="flex items-start">
                <span className="text-steel-blue mr-2">•</span>
                <span>
                  Mostre leilões no estado de Rio Grande do Norte, cidade de Natal
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-steel-blue mr-2">•</span>
                <span>
                  Estou interessado em leilões da Caixa em Licitação Aberta no estado
                  do RN e cidade do Natal, cujo valor seja de pelo menos R$200.000,00
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-steel-blue mr-2">•</span>
                <span>
                  Quais são os imóveis em São Paulo com preço entre R$100.000,00 e
                  R$300.000,00?
                </span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

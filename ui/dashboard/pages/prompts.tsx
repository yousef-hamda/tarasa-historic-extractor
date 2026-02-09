import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';
import {
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  PlayIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface Prompt {
  id: number;
  type: string;
  name: string;
  content: string;
  isActive: boolean;
  version: number;
  createdAt: string;
}

interface PromptsData {
  active: {
    classifier: Prompt;
    generator: Prompt;
  };
  history: {
    classifier: Prompt[];
    generator: Prompt[];
  };
  defaults: {
    classifier: string;
    generator: string;
  };
}

interface TestResult {
  success: boolean;
  result?: {
    is_historic?: boolean;
    confidence?: number;
    reason?: string;
    message?: string;
  };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

type PromptType = 'classifier' | 'generator';

const PromptsPage: React.FC = () => {
  const { t } = useLanguage();
  const [data, setData] = useState<PromptsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [activeTab, setActiveTab] = useState<PromptType>('classifier');
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Test state
  const [sampleText, setSampleText] = useState('');
  const [sampleAuthor, setSampleAuthor] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/prompts');
      if (!res.ok) throw new Error('Failed to fetch prompts');
      const result = await res.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  // Load active prompt content when tab changes
  useEffect(() => {
    if (data) {
      const activePrompt = data.active[activeTab];
      setEditContent(activePrompt.content);
      setEditName('');
      setIsEditing(false);
      setTestResult(null);
    }
  }, [activeTab, data]);

  const handleTest = async () => {
    if (!sampleText.trim()) return;

    setTesting(true);
    setTestResult(null);

    try {
      const res = await apiFetch('/api/prompts/test', {
        method: 'POST',
        body: JSON.stringify({
          type: activeTab,
          content: editContent,
          sampleText: sampleText.trim(),
          sampleAuthor: sampleAuthor.trim() || undefined,
        }),
      });

      const result = await res.json();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        result: { reason: err instanceof Error ? err.message : 'Test failed' },
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (setActive: boolean) => {
    if (!editContent.trim()) return;

    setSaving(true);
    setSaveResult(null);

    try {
      const res = await apiFetch('/api/prompts', {
        method: 'POST',
        body: JSON.stringify({
          type: activeTab,
          name: editName.trim() || undefined,
          content: editContent.trim(),
          setActive,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setSaveResult({ success: true, message: `Prompt saved${setActive ? ' and activated' : ''}` });
        setIsEditing(false);
        fetchPrompts();
      } else {
        setSaveResult({ success: false, message: result.error || 'Save failed' });
      }
    } catch (err) {
      setSaveResult({ success: false, message: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (promptId: number) => {
    try {
      const res = await apiFetch(`/api/prompts/${promptId}/activate`, { method: 'POST' });
      const result = await res.json();

      if (result.success) {
        fetchPrompts();
      }
    } catch (err) {
      console.error('Activation failed:', err);
    }
  };

  const handleDelete = async (promptId: number) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    try {
      const res = await apiFetch(`/api/prompts/${promptId}`, { method: 'DELETE' });
      const result = await res.json();

      if (result.success) {
        fetchPrompts();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleRevertToDefault = () => {
    if (data) {
      setEditContent(data.defaults[activeTab]);
      setIsEditing(true);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="h-96 skeleton" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('prompts.title')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t('prompts.subtitle')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
              <p className="text-slate-600 text-sm">{error}</p>
              <button onClick={fetchPrompts} className="btn-primary mt-4">
                <ArrowPathIcon className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activePrompt = data.active[activeTab];
  const historyPrompts = data.history[activeTab];

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('prompts.title')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t('prompts.subtitle')}</p>
        </div>
        <button onClick={fetchPrompts} className="btn-secondary">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Tab Selection */}
      <div className="bg-white border border-slate-200 rounded-xl p-1 inline-flex">
        <button
          onClick={() => setActiveTab('classifier')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'classifier'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <SparklesIcon className="w-4 h-4" />
          {t('prompts.classifierPrompt')}
        </button>
        <button
          onClick={() => setActiveTab('generator')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'generator'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <ChatBubbleLeftRightIcon className="w-4 h-4" />
          {t('prompts.generatorPrompt')}
        </button>
      </div>

      {/* Current Active Prompt Info */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">{t('prompts.currentPrompt')}</h2>
              <p className="text-sm text-slate-500">
                {activePrompt.name} • v{activePrompt.version}
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">
            Active
          </span>
        </div>
      </div>

      {/* Prompt Editor */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{t('prompts.editPrompt')}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRevertToDefault}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              {t('prompts.revertToDefault')}
            </button>
          </div>
        </div>
        <div className="p-5">
          {/* Name Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Version Name (optional)
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setIsEditing(true);
              }}
              placeholder={`${activeTab} v${(activePrompt.version || 0) + 1}`}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          {/* Content Textarea */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Prompt Content
            </label>
            <textarea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setIsEditing(true);
              }}
              rows={12}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
              placeholder="Enter your prompt..."
            />
          </div>

          {/* Save Result */}
          {saveResult && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
                saveResult.success ? 'bg-emerald-50' : 'bg-red-50'
              }`}
            >
              {saveResult.success ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircleIcon className="w-5 h-5 text-red-500" />
              )}
              <span
                className={`text-sm ${saveResult.success ? 'text-emerald-700' : 'text-red-700'}`}
              >
                {saveResult.message}
              </span>
            </div>
          )}

          {/* Save Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(true)}
              disabled={saving || !isEditing}
              className={`btn-primary ${(!isEditing || saving) && 'opacity-50 cursor-not-allowed'}`}
            >
              {saving ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircleIcon className="w-4 h-4" />
              )}
              {t('prompts.savePrompt')} & Activate
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving || !isEditing}
              className={`btn-secondary ${(!isEditing || saving) && 'opacity-50 cursor-not-allowed'}`}
            >
              <DocumentDuplicateIcon className="w-4 h-4" />
              Save as Draft
            </button>
          </div>
        </div>
      </div>

      {/* Test Prompt */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{t('prompts.testPrompt')}</h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Sample Post Text
              </label>
              <textarea
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                placeholder="Enter a sample Facebook post to test the prompt..."
              />
            </div>
            {activeTab === 'generator' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Author Name
                </label>
                <input
                  type="text"
                  value={sampleAuthor}
                  onChange={(e) => setSampleAuthor(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  placeholder="Enter author name..."
                />
              </div>
            )}
          </div>

          <button
            onClick={handleTest}
            disabled={testing || !sampleText.trim()}
            className={`btn-secondary mb-4 ${(!sampleText.trim() || testing) && 'opacity-50 cursor-not-allowed'}`}
          >
            {testing ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <PlayIcon className="w-4 h-4" />
            )}
            {testing ? 'Testing...' : t('prompts.testWithSample')}
          </button>

          {/* Test Result */}
          {testResult && (
            <div className={`p-4 rounded-lg ${testResult.success ? 'bg-slate-50' : 'bg-red-50'}`}>
              <h4 className="font-medium text-slate-900 mb-2">{t('prompts.previewResults')}</h4>
              {testResult.success && testResult.result ? (
                activeTab === 'classifier' ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Historic:</span>
                      <span
                        className={`font-medium ${testResult.result.is_historic ? 'text-emerald-600' : 'text-slate-600'}`}
                      >
                        {testResult.result.is_historic ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Confidence:</span>
                      <span className="font-medium">{testResult.result.confidence}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Reason:</span>
                      <p className="mt-1 text-slate-700">{testResult.result.reason}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm">
                    <span className="text-slate-500">Generated Message:</span>
                    <p className="mt-2 p-3 bg-white rounded border text-slate-700 whitespace-pre-wrap">
                      {testResult.result.message}
                    </p>
                  </div>
                )
              ) : (
                <p className="text-red-600 text-sm">{testResult.result?.reason || 'Test failed'}</p>
              )}
              {testResult.usage && (
                <p className="text-xs text-slate-400 mt-2">
                  Tokens: {testResult.usage.total_tokens} (prompt: {testResult.usage.prompt_tokens},
                  completion: {testResult.usage.completion_tokens})
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Prompt History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{t('prompts.promptHistory')}</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {historyPrompts.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No prompt history yet</div>
          ) : (
            historyPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className={`px-5 py-4 flex items-center justify-between hover:bg-slate-50 ${
                  prompt.isActive ? 'bg-emerald-50' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      prompt.isActive ? 'bg-emerald-100' : 'bg-slate-100'
                    }`}
                  >
                    <span
                      className={`text-sm font-bold ${prompt.isActive ? 'text-emerald-600' : 'text-slate-500'}`}
                    >
                      v{prompt.version}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{prompt.name}</span>
                      {prompt.isActive && (
                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                      <ClockIcon className="w-3 h-3" />
                      {new Date(prompt.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!prompt.isActive && (
                    <>
                      <button
                        onClick={() => handleActivate(prompt.id)}
                        className="px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg"
                      >
                        Activate
                      </button>
                      <button
                        onClick={() => {
                          setEditContent(prompt.content);
                          setEditName(`Copy of ${prompt.name}`);
                          setIsEditing(true);
                        }}
                        className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => handleDelete(prompt.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PromptsPage;

export const getServerSideProps = async () => {
  return { props: {} };
};

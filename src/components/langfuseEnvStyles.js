export const DEFAULT_LANGFUSE_ENV_STYLE = {
  badge: 'bg-slate-800 border-slate-500 text-slate-200',
  dot: 'bg-slate-300',
  active: 'ring-slate-400',
};

export const LANGFUSE_ENV_STYLES = {
  UAT: { badge: 'bg-purple-900/50 border-purple-600 text-purple-300', dot: 'bg-purple-400', active: 'ring-purple-500' },
  UAT_LOCAL: { badge: 'bg-cyan-900/50 border-cyan-600 text-cyan-300', dot: 'bg-cyan-400', active: 'ring-cyan-500' },
  TEST: { badge: 'bg-yellow-900/50 border-yellow-600 text-yellow-300', dot: 'bg-yellow-400', active: 'ring-yellow-500' },
  TEST_LOCAL: { badge: 'bg-lime-900/50 border-lime-600 text-lime-300', dot: 'bg-lime-400', active: 'ring-lime-500' },
  PROD: { badge: 'bg-red-900/50 border-red-600 text-red-300', dot: 'bg-red-400', active: 'ring-red-500' },
  PROD_LOCAL: { badge: 'bg-rose-900/50 border-rose-600 text-rose-300', dot: 'bg-rose-400', active: 'ring-rose-500' },
};

export function getLangfuseEnvStyle(envKey) {
  return LANGFUSE_ENV_STYLES[envKey] || DEFAULT_LANGFUSE_ENV_STYLE;
}

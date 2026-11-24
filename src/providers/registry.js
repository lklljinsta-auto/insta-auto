// Each provider owns its endpoint, authentication and supported media types.
// Bootstrap additional providers here. Selection is independent per generation stage.
import { openai } from './openai.js';

const providers = new Map();
export function registerProvider(name, adapter) {
  if (!/^[a-z][a-z0-9_-]*$/.test(name) || providers.has(name)) throw new Error('duplicate_or_invalid_provider');
  providers.set(name,Object.freeze({...adapter}));
}
export function adapterFor(name, capability) {
  const handler = providers.get(name)?.[capability];
  if (typeof handler !== 'function') {
    const code = capability + '_adapter_unavailable';
    throw Object.assign(new Error(code),{code,status:409,publicCode:code});
  }
  return handler;
}
registerProvider('openai',openai);

import {AsyncLocalStorage} from 'node:async_hooks';
import {env} from 'cloudflare:workers';

const requestBindings = new AsyncLocalStorage<Cloudflare.Env>();
let lastBindingState = '';

export function discoveryConfig() {
  const bindings = requestBindings.getStore();
  function read(key: 'META_DISCOVERY_ACCESS_TOKEN' | 'META_DISCOVERY_IG_ID') {
    for (const source of [bindings, env, process.env]) {
      const value = source?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }
  const token = read('META_DISCOVERY_ACCESS_TOKEN');
  const id = read('META_DISCOVERY_IG_ID');
  const problem = !token ? '조회 토큰 없음' : !id ? 'Instagram 계정 ID 없음' : !/^\d+$/.test(id) ? 'Instagram 계정 ID 형식 오류' : '';
  return {token, id, problem};
}

export function withDiscoveryBindings<T>(bindings: Cloudflare.Env, run: () => T) {
  return requestBindings.run(bindings, () => {
    const config = discoveryConfig();
    const state = JSON.stringify({tokenPresent: Boolean(config.token), accountIdPresent: Boolean(config.id), accountIdValid: /^\d+$/.test(config.id)});
    if (state !== lastBindingState) {
      lastBindingState = state;
      console.info('instagram.research.config ' + state);
    }
    return run();
  });
}

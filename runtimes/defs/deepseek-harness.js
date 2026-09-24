module.exports = {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  bin: 'dsh',
  fallbackBins: [],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: 'Default (CLI config)', default: true }
  ],
  buildArgs: () => ['--profile', 'open-design', '--stdio'],
  promptViaStdin: true,
  streamFormat: 'plain',
  listModels: {
    args: ['--profile', 'open-design', '--models'],
    timeoutMs: 10000,
    parse: (stdout) => {
      const text = String(stdout || '').trim();
      if (!text) return [];
      try {
        const v = JSON.parse(text.split(/\r?\n/).filter(Boolean)[0] || text);
        if (v && typeof v === 'object' && v.v === 1 && v.type === 'models' && Array.isArray(v.models)) {
          const out = [{ id: 'default', label: 'Default (CLI config)', default: true }];
          const seen = new Set(['default']);
          for (const m of v.models) {
            if (!m || typeof m !== 'object') continue;
            const provider = String(m.provider || '').trim();
            const id = String(m.id || '').trim();
            const name = String(m.name || '').trim();
            const providerName = String(m.provider_name || m.provider || '').trim();
            if (!provider || !id || !name) continue;
            const fullId = provider + '/' + id;
            if (seen.has(fullId)) continue;
            seen.add(fullId);
            const label = providerName ? (name + ' · ' + providerName) : (provider + '/' + id);
            out.push({ id: fullId, label });
          }
          return out;
        }
      } catch (_) {}
      // fallback: line-separated ids
      const ids = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      const seen2 = new Set();
      const out2 = [];
      for (const id of ids) {
        const norm = id.replace(/[-_]free$/i,'').trim();
        if (!norm || norm==='default' || seen2.has(norm)) continue;
        seen2.add(norm);
        out2.push({ id: norm, label: norm });
      }
      if (out2.length) return [{ id:'default', label:'Default (CLI config)', default:true }, ...out2];
      return [{ id:'default', label:'Default (CLI config)', default:true }];
    }
  }
};

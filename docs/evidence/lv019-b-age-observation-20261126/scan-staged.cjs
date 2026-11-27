const cp = require('node:child_process');
const crypto = require('node:crypto');
const files = cp.execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['openai-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+\/-]{32,}/i],
  ['service-account-key', /"private_key"\s*:\s*"(?:\\n|[^"\\]){30,}"/],
  ['credential-assignment', /["']?(?:api[_-]?key|client[_-]?secret|password|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{24,}["']/i],
];
const names = /(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json|service-account[^/]*\.json|.*\.(?:pem|p12|pfx))$/i;
const findings=[]; let bytes=0;const digest=crypto.createHash('sha256');
for(const file of files){
  if(names.test(file)) findings.push({file,rule:'credential-filename'});
  const content=cp.execFileSync('git',['show',':'+file],{maxBuffer:20*1024*1024});
  bytes+=content.length;digest.update(file+'\0');digest.update(content);
  const text=content.toString('utf8');
  for(const [rule,pattern] of rules)if(pattern.test(text))findings.push({file,rule});
}
console.log(JSON.stringify({scope:'all staged file contents and names; published parent already exists on origin',files:files.length,bytes,stagedContentSha256:digest.digest('hex'),rules:rules.map(r=>r[0]).concat('credential-filename'),findings},null,2));
process.exit(findings.length?1:0);

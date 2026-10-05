const { execSync } = require('child_process');
const git = '"C:\\Program Files\\Git\\cmd\\git.exe"';

function run(cmd) {
  console.log('RUNNING:', cmd);
  try {
    const out = execSync(`${git} ${cmd}`, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // Don't hang on terminal prompts
      },
    });
    console.log(out.trim());
    return { success: true, out };
  } catch (err) {
    console.error('CMD_ERROR:', err.stderr ? err.stderr.trim() : err.message);
    return { success: false, error: err.stderr ? err.stderr.trim() : err.message };
  }
}

console.log('=== INITIALIZING GIT ===');
run('init');
run('branch -M main');
run('config user.name "nayyairtesneem141-afk"');
run('config user.email "nayyairtesneem141@users.noreply.github.com"');

// Set origin
run('remote remove origin');
run('remote add origin https://github.com/nayyairtesneem141-afk/KaziBox.git');

console.log('=== STAGING FILES ===');
run('add -A');

console.log('=== COMMITTING ===');
run('commit -m "feat: initial commit for KaziBox Phase 1 modular platform (PWA)"');

console.log('=== PUSHING TO GITHUB ===');
const pushResult = run('push -u origin main --force');
if (pushResult.success) {
  console.log('PUSH_SUCCESSFUL');
} else {
  console.log('PUSH_FAILED_AUTH_OR_REMOTE');
}

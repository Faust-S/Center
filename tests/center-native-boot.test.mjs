import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('installed Center retains visible static startup when JS bundle never executes',()=>{
  const html=readFileSync('index.html','utf8');
  assert.match(html,/<div id="root">[\s\S]*?data-testid="iwxa-bootstrap"/);
  assert.match(html,/<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.match(html,/Открываем рабочее место/);
  assert.doesNotMatch(html,/<script>(?!\s*<\/script>)/);
});

test('React rendering errors are visible without reading or altering user data',()=>{
  const main=readFileSync('src/main.tsx','utf8');
  assert.match(main,/class CenterRenderBoundary extends React\.Component/);
  assert.match(main,/static getDerivedStateFromError/);
  assert.match(main,/data-testid="center-boot-failure"/);
  assert.match(main,/<CenterRenderBoundary><App\/><\/CenterRenderBoundary>/);
  assert.match(main,/IWXA_CENTER_REACT_RENDER_FAILED/);
  assert.doesNotMatch(main,/localStorage\.|sessionStorage\./);
});

test('installed GUI qualification preserves failure evidence without accepting blank WebView',()=>{
  const driver=readFileSync('tests/installed-windows-center.ps1','utf8');
  assert.match(driver,/function Capture-CenterRuntimeDiagnostic/);
  assert.match(driver,/function Capture-CenterFailure/);
  assert.match(driver,/installed-gui-diagnostic\.json/);
  assert.match(driver,/CENTER_INSTALLED_GUI_FAIL/);
  assert.match(driver,/Capture-CenterFailure\s+Capture-CenterRuntimeDiagnostic\s+throw/);
  const workflow=readFileSync('.github/workflows/center.yml','utf8');
  assert.match(workflow,/artifacts\/installed-gui-diagnostic\.json/);
});

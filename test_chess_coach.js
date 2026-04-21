/**
 * Playwright test for chess_coach.html
 * Tests: engine status, PGN loading, board rendering, hint arrow
 */

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE_URL = 'http://localhost:8765/chess_coach.html';
const TEST_PGN = `[Event "BLUNDER #14 — Move 41 — Endgame"]
[Site "Hypatia — nevradonat"]
[Date "2026.03.26"]
[SetUp "1"]
[FEN "8/6p1/7p/4P3/1kP5/p2K2PP/8/8 w - - 0 41"]
[Result "*"]
[Orientation "white"]

{ White to move. Find the best move!  | BLUNDER: 41. e6 (92.3% loss)  | Best: Kc2  | Theme: Endgame technique  | Date: 2026.03.26 }
1. Kc2 { Best move } *`;

async function runTests() {
  let passed = 0;
  let failed = 0;
  const errors = [];
  const consoleErrors = [];

  console.log('='.repeat(60));
  console.log('Chess Coach Playwright Test Suite');
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture ALL console messages
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error' || text.toLowerCase().includes('stockfish') ||
        text.toLowerCase().includes('worker') || text.toLowerCase().includes('wasm') ||
        text.toLowerCase().includes('engine')) {
      consoleErrors.push({ type, text });
      console.log(`  [BROWSER ${type.toUpperCase()}] ${text}`);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push({ type: 'pageerror', text: err.message });
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

  page.on('worker', worker => {
    console.log(`  [WORKER CREATED] ${worker.url()}`);
    worker.on('close', () => console.log('  [WORKER CLOSED]'));
  });

  try {
    console.log(`\nOpening: ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log('Page loaded.');

    // ── TEST 1: Engine status ──────────────────────────────────────
    console.log('\n[TEST 1] Engine status');
    let engineStatus = null;
    try {
      // Wait up to 15 seconds for engine to be ready OR show error
      await page.waitForFunction(() => {
        const label = document.getElementById('engine-status-label');
        if (!label) return false;
        const t = label.textContent.trim();
        return t !== 'Loading engine…' && t !== 'Loading engine...' && t !== '';
      }, { timeout: 15000 });

      engineStatus = await page.$eval('#engine-status-label', el => el.textContent.trim());
      console.log(`  Engine status: "${engineStatus}"`);

      const isOk = engineStatus.toLowerCase().includes('ready') ||
                   engineStatus.toLowerCase().includes('analys');
      if (isOk) {
        console.log('  PASS: Engine is ready/analysing');
        passed++;
      } else {
        console.log(`  FAIL: Engine status is "${engineStatus}" (expected "ready" or "analysing")`);
        failed++;
        errors.push(`Engine status: "${engineStatus}"`);
      }
    } catch (e) {
      engineStatus = await page.$eval('#engine-status-label', el => el.textContent.trim()).catch(() => 'N/A');
      console.log(`  FAIL: Timed out waiting for engine. Last status: "${engineStatus}"`);
      failed++;
      errors.push(`Engine timeout. Last status: "${engineStatus}"`);
    }

    // ── TEST 2: PGN load and board render ─────────────────────────
    console.log('\n[TEST 2] PGN load and board render');
    try {
      // Clear pgn-input and type test PGN
      await page.click('#pgn-input');
      await page.fill('#pgn-input', TEST_PGN);
      await page.click('#btn-load-pgn');
      await page.waitForTimeout(1000);

      // Check FEN display shows the expected FEN
      const fenText = await page.$eval('#fen-display', el => el.textContent.trim()).catch(() => '');
      console.log(`  FEN display: "${fenText.substring(0, 80)}..."`);

      const expectedFenStart = '8/6p1/7p/4P3/1kP5/p2K2PP/8/8';
      if (fenText.includes(expectedFenStart)) {
        console.log('  PASS: FEN matches expected endgame position');
        passed++;
      } else {
        console.log(`  FAIL: FEN does not match. Got: "${fenText}"`);
        failed++;
        errors.push(`FEN mismatch: "${fenText}"`);
      }

      // Check board canvas is rendered (non-zero)
      const boardVisible = await page.$eval('#board-canvas', el => {
        return el.width > 0 && el.height > 0;
      }).catch(() => false);

      if (boardVisible) {
        console.log('  PASS: Board canvas is rendered (non-zero size)');
        passed++;
      } else {
        console.log('  FAIL: Board canvas has zero size or not found');
        failed++;
        errors.push('Board canvas not rendered');
      }

      // Check move list has at least one move chip
      const moveChips = await page.$$('.move-chip');
      if (moveChips.length > 0) {
        console.log(`  PASS: Move list has ${moveChips.length} move(s)`);
        passed++;
      } else {
        console.log('  FAIL: No moves in move list');
        failed++;
        errors.push('No moves in move list');
      }

    } catch (e) {
      console.log(`  FAIL: PGN test threw: ${e.message}`);
      failed++;
      errors.push(`PGN test error: ${e.message}`);
    }

    // ── TEST 3: Hint button shows arrow ───────────────────────────
    console.log('\n[TEST 3] Hint button shows gold arrow');
    try {
      // Navigate to initial position (move 0) so we can get a hint for the starting position
      // First go to start
      const firstBtn = await page.$('#btn-start');
      if (firstBtn) await firstBtn.click();
      await page.waitForTimeout(500);

      // Find hint button
      const hintBtn = await page.$('#btn-hint');
      if (!hintBtn) {
        console.log('  SKIP: No #btn-hint button found (checking by text...)');
        // Try finding by text
        const allBtns = await page.$$('button');
        for (const btn of allBtns) {
          const text = await btn.textContent();
          if (text && text.toLowerCase().includes('hint')) {
            console.log(`  Found hint button with text: "${text}"`);
            await btn.click();
            break;
          }
        }
      } else {
        await hintBtn.click();
      }

      await page.waitForTimeout(2000);

      // Check arrow canvas has content drawn on it
      const arrowHasContent = await page.evaluate(() => {
        const canvas = document.getElementById('arrow-canvas');
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Check if any pixel has non-zero values (any drawing)
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0 || data[i+3] > 0) {
            return true;
          }
        }
        return false;
      });

      if (arrowHasContent) {
        console.log('  PASS: Arrow canvas has content (hint arrow visible)');
        passed++;
      } else {
        console.log('  FAIL: Arrow canvas is empty (no hint arrow drawn)');
        failed++;
        errors.push('No hint arrow drawn on canvas');
      }
    } catch (e) {
      console.log(`  FAIL: Hint test threw: ${e.message}`);
      failed++;
      errors.push(`Hint test error: ${e.message}`);
    }

  } catch (e) {
    console.log(`\nFATAL ERROR: ${e.message}`);
    failed++;
    errors.push(`Fatal: ${e.message}`);
  } finally {
    await browser.close();
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log('\nFailures:');
    errors.forEach((e, i) => console.log(`  ${i+1}. ${e}`));
  }
  if (consoleErrors.length > 0) {
    console.log('\nBrowser console errors/warnings:');
    consoleErrors.forEach(e => console.log(`  [${e.type}] ${e.text}`));
  }
  console.log('='.repeat(60));

  return failed === 0;
}

runTests().then(ok => {
  process.exit(ok ? 0 : 1);
}).catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});

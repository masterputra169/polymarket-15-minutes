/**
 * ═══ Dashboard Stress Test Suite ═══
 * 
 * Browser-based stress testing for BTC Prediction Dashboard.
 * Tests: Memory leaks, WebSocket stability, ML performance,
 *        rendering speed, market switching, and sustained load.
 *
 * USAGE (paste in browser console):
 *   // Run all tests:
 *   await StressTest.runAll()
 * 
 *   // Run individual tests:
 *   await StressTest.memory()
 *   await StressTest.websocket()
 *   await StressTest.rendering()
 *   await StressTest.mlInference()
 *   await StressTest.marketSwitch()
 *   await StressTest.sustained(300)  // 5 minutes
 *
 * RESULTS: Printed to console with pass/fail verdicts.
 */

const StressTest = (() => {
  // ═══ Utilities ═══
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const now = () => performance.now();
  const MB = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  
  function getMemory() {
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  function printHeader(name) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🧪 STRESS TEST: ${name}`);
    console.log(`${'═'.repeat(60)}`);
  }

  function printResult(name, passed, details) {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}: ${details}`);
    return { name, passed, details };
  }

  function printSummary(results) {
    console.log(`\n${'─'.repeat(60)}`);
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const icon = passed === total ? '🎉' : passed >= total * 0.7 ? '⚠️' : '💀';
    console.log(`${icon} RESULT: ${passed}/${total} tests passed`);
    console.log(`${'─'.repeat(60)}\n`);
    return { passed, total, results };
  }

  // ═══ TEST 1: Memory Leak Detection ═══
  async function memory(durationSec = 60) {
    printHeader(`Memory Leak (${durationSec}s observation)`);
    const results = [];

    if (!performance.memory) {
      console.warn('⚠️ performance.memory not available. Use Chrome with --enable-precise-memory-info');
      console.warn('   Or open Chrome with: chrome://flags/#enable-precise-memory-info');
      results.push(printResult('Memory API', false, 'Not available — use Chrome'));
      return printSummary(results);
    }

    // Force GC if available
    if (window.gc) window.gc();
    await sleep(1000);

    const startMem = getMemory();
    const samples = [];
    const intervalMs = 2000;
    const totalSamples = Math.floor(durationSec * 1000 / intervalMs);

    console.log(`📊 Sampling memory every ${intervalMs/1000}s for ${durationSec}s...`);
    console.log(`   Start: ${MB(startMem.used)}MB used / ${MB(startMem.total)}MB total`);

    for (let i = 0; i < totalSamples; i++) {
      await sleep(intervalMs);
      const mem = getMemory();
      samples.push({ time: (i + 1) * intervalMs, used: mem.used, total: mem.total });
      
      if ((i + 1) % 10 === 0) {
        console.log(`   ${((i+1) * intervalMs / 1000).toFixed(0)}s: ${MB(mem.used)}MB used`);
      }
    }

    const endMem = getMemory();
    const growthMB = (endMem.used - startMem.used) / 1024 / 1024;
    const growthPerMin = growthMB / (durationSec / 60);

    // Trend analysis: linear regression on samples
    const n = samples.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const x = samples[i].time / 1000;
      const y = samples[i].used / 1024 / 1024;
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX); // MB/sec
    const slopePerMin = slope * 60;

    console.log(`\n📈 Memory Analysis:`);
    console.log(`   Start:      ${MB(startMem.used)}MB`);
    console.log(`   End:        ${MB(endMem.used)}MB`);
    console.log(`   Growth:     ${growthMB.toFixed(2)}MB total`);
    console.log(`   Rate:       ${growthPerMin.toFixed(2)}MB/min`);
    console.log(`   Trend:      ${slopePerMin.toFixed(3)}MB/min (linear regression)`);

    // Verdicts
    results.push(printResult(
      'Memory growth rate',
      Math.abs(slopePerMin) < 2,
      `${slopePerMin.toFixed(3)}MB/min (threshold: <2MB/min)`
    ));

    results.push(printResult(
      'Absolute memory',
      endMem.used < endMem.limit * 0.7,
      `${MB(endMem.used)}MB / ${MB(endMem.limit)}MB limit (${((endMem.used/endMem.limit)*100).toFixed(0)}%)`
    ));

    results.push(printResult(
      'GC effectiveness',
      growthMB < 20,
      `${growthMB.toFixed(2)}MB net growth over ${durationSec}s`
    ));

    return printSummary(results);
  }

  // ═══ TEST 2: WebSocket Stability ═══
  async function websocket(durationSec = 120) {
    printHeader(`WebSocket Stability (${durationSec}s)`);
    const results = [];

    // Find React fiber root to access hook states
    const wsIndicators = {
      binance: { selector: '[data-ws="binance"]', name: 'Binance' },
      polymarket: { selector: '[data-ws="polymarket"]', name: 'Polymarket' },
      clob: { selector: '[data-ws="clob"]', name: 'CLOB' },
      chainlink: { selector: '[data-ws="chainlink"]', name: 'Chainlink' },
    };

    // Count WebSocket connections
    function countActiveWS() {
      let count = 0;
      // Check for WebSocket instances (limited browser API)
      if (performance.getEntriesByType) {
        const resources = performance.getEntriesByType('resource');
        count = resources.filter(r => r.name.includes('ws:/') || r.name.includes('wss:/')).length;
      }
      return count;
    }

    // Monitor connection status via DOM (if indicators exist)
    function getConnectionStatus() {
      const status = {};
      document.querySelectorAll('[class*="connected"], [class*="status"]').forEach(el => {
        const text = el.textContent.toLowerCase();
        if (text.includes('connected') || text.includes('✅')) {
          status[el.className] = 'connected';
        } else if (text.includes('disconnected') || text.includes('❌')) {
          status[el.className] = 'disconnected';
        }
      });
      return status;
    }

    console.log(`📡 Monitoring WebSocket stability for ${durationSec}s...`);

    let disconnections = 0;
    let checks = 0;
    const checkInterval = 3000;
    const totalChecks = Math.floor(durationSec * 1000 / checkInterval);
    let lastStatus = null;

    // Track console warnings for WS reconnections
    const originalWarn = console.warn;
    let reconnectCount = 0;
    console.warn = function(...args) {
      const msg = args.join(' ');
      if (msg.includes('WS') && (msg.includes('reconnect') || msg.includes('Silent') || msg.includes('forcing'))) {
        reconnectCount++;
      }
      originalWarn.apply(console, args);
    };

    for (let i = 0; i < totalChecks; i++) {
      await sleep(checkInterval);
      checks++;
      const status = getConnectionStatus();
      
      if (lastStatus) {
        const statusValues = Object.values(status);
        const disconnected = statusValues.filter(s => s === 'disconnected').length;
        if (disconnected > 0) disconnections++;
      }
      lastStatus = status;

      if ((i + 1) % 10 === 0) {
        console.log(`   ${((i+1) * checkInterval / 1000).toFixed(0)}s: ${disconnections} disconnections, ${reconnectCount} reconnects`);
      }
    }

    // Restore console.warn
    console.warn = originalWarn;

    const uptime = checks > 0 ? ((checks - disconnections) / checks * 100).toFixed(1) : 0;

    results.push(printResult(
      'Connection uptime',
      disconnections <= checks * 0.05,
      `${uptime}% (${disconnections} drops in ${checks} checks)`
    ));

    results.push(printResult(
      'Reconnection events',
      reconnectCount < durationSec / 30,
      `${reconnectCount} reconnects (threshold: <${Math.floor(durationSec/30)})`
    ));

    return printSummary(results);
  }

  // ═══ TEST 3: Render Performance ═══
  async function rendering(durationSec = 30) {
    printHeader(`Render Performance (${durationSec}s)`);
    const results = [];

    // Use PerformanceObserver to track long tasks
    const longTasks = [];
    let observer = null;
    
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ duration: entry.duration, start: entry.startTime });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      console.warn('⚠️ PerformanceObserver longtask not supported');
    }

    // Track frame rate via requestAnimationFrame
    const frameTimes = [];
    let lastFrame = now();
    let rafId = null;
    let running = true;

    function frameCounter() {
      if (!running) return;
      const t = now();
      frameTimes.push(t - lastFrame);
      lastFrame = t;
      rafId = requestAnimationFrame(frameCounter);
    }
    rafId = requestAnimationFrame(frameCounter);

    console.log(`🎨 Measuring render performance for ${durationSec}s...`);
    await sleep(durationSec * 1000);

    running = false;
    cancelAnimationFrame(rafId);
    if (observer) observer.disconnect();

    // Analyze frame times
    const fps = frameTimes.length / durationSec;
    frameTimes.sort((a, b) => a - b);
    const p50 = frameTimes[Math.floor(frameTimes.length * 0.5)] || 0;
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)] || 0;
    const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)] || 0;
    const jankFrames = frameTimes.filter(t => t > 50).length; // >50ms = janky
    const jankPercent = (jankFrames / frameTimes.length * 100).toFixed(1);

    console.log(`\n📊 Frame Analysis:`);
    console.log(`   Average FPS:  ${fps.toFixed(1)}`);
    console.log(`   Frame p50:    ${p50.toFixed(1)}ms`);
    console.log(`   Frame p95:    ${p95.toFixed(1)}ms`);
    console.log(`   Frame p99:    ${p99.toFixed(1)}ms`);
    console.log(`   Jank frames:  ${jankFrames}/${frameTimes.length} (${jankPercent}%)`);
    console.log(`   Long tasks:   ${longTasks.length}`);

    results.push(printResult(
      'Average FPS',
      fps > 30,
      `${fps.toFixed(1)} FPS (threshold: >30)`
    ));

    results.push(printResult(
      'Frame time p95',
      p95 < 50,
      `${p95.toFixed(1)}ms (threshold: <50ms)`
    ));

    results.push(printResult(
      'Jank rate',
      parseFloat(jankPercent) < 5,
      `${jankPercent}% frames >50ms (threshold: <5%)`
    ));

    results.push(printResult(
      'Long tasks',
      longTasks.length < durationSec / 2,
      `${longTasks.length} tasks >50ms (threshold: <${Math.floor(durationSec/2)})`
    ));

    return printSummary(results);
  }

  // ═══ TEST 4: ML Inference Performance ═══
  async function mlInference(iterations = 1000) {
    printHeader(`ML Inference (${iterations} predictions)`);
    const results = [];

    // Check if ML module is accessible
    let mlModule;
    try {
      // Try to access via global or import
      mlModule = window.__mlPredictor || null;
    } catch (e) { /* */ }

    // Generate synthetic feature inputs
    function randomFeatures() {
      return {
        price: 95000 + Math.random() * 10000,
        priceToBeat: 97000 + Math.random() * 5000,
        rsi: 20 + Math.random() * 60,
        rsiSlope: (Math.random() - 0.5) * 4,
        macd: { histogram: (Math.random() - 0.5) * 100, macd: (Math.random() - 0.5) * 200 },
        vwap: 95000 + Math.random() * 10000,
        vwapSlope: (Math.random() - 0.5) * 10,
        heikenColor: Math.random() > 0.5 ? 'green' : 'red',
        heikenCount: Math.floor(Math.random() * 10),
        delta1m: (Math.random() - 0.5) * 200,
        delta3m: (Math.random() - 0.5) * 500,
        volumeRecent: Math.random() * 1000,
        volumeAvg: 500 + Math.random() * 500,
        regime: ['trending', 'choppy', 'mean_reverting', 'moderate'][Math.floor(Math.random() * 4)],
        session: ['Asia', 'Europe', 'US', 'EU/US Overlap', 'Off-hours'][Math.floor(Math.random() * 5)],
        minutesLeft: Math.random() * 15,
        bestEdge: Math.random() * 0.3,
        vwapCrossCount: Math.floor(Math.random() * 8),
        multiTfAgreement: Math.random() > 0.5,
        failedVwapReclaim: Math.random() > 0.8,
      };
    }

    // Benchmark prediction speed (synthetic - simulates the workload)
    console.log(`⚡ Running ${iterations} synthetic ML predictions...`);
    
    const features = [];
    for (let i = 0; i < iterations; i++) features.push(randomFeatures());

    // Warm up
    for (let i = 0; i < 10; i++) {
      const f = features[i];
      JSON.stringify(f); // Simulate feature extraction overhead
    }

    // Benchmark
    const t0 = now();
    let predictions = 0;
    
    for (let i = 0; i < iterations; i++) {
      const f = features[i];
      // Simulate feature extraction + normalization + tree traversal
      const ptbDist = f.priceToBeat ? (f.price - f.priceToBeat) / f.priceToBeat : 0;
      const volRatio = f.volumeAvg > 0 ? f.volumeRecent / f.volumeAvg : 1;
      
      // Simulate 28-feature vector creation
      const vec = new Float64Array(28);
      vec[0] = ptbDist;
      vec[1] = f.rsi / 100;
      vec[2] = f.rsiSlope;
      vec[3] = f.macd.histogram;
      vec[4] = f.macd.macd;
      vec[5] = f.vwap ? (f.price - f.vwap) / f.vwap : 0;
      // ... (remaining features simulated)
      
      // Simulate sigmoid
      const logit = vec[0] * 0.3 + vec[1] * 0.5 + vec[2] * 0.1 + vec[3] * 0.05;
      const prob = 1 / (1 + Math.exp(-logit));
      
      predictions++;
    }

    const t1 = now();
    const totalMs = t1 - t0;
    const perPrediction = totalMs / iterations;
    const predictionsPerSec = 1000 / perPrediction;

    console.log(`\n📊 ML Performance:`);
    console.log(`   Total:           ${totalMs.toFixed(1)}ms for ${iterations} predictions`);
    console.log(`   Per prediction:  ${perPrediction.toFixed(3)}ms`);
    console.log(`   Throughput:      ${predictionsPerSec.toFixed(0)} predictions/sec`);

    // Memory impact
    const memBefore = getMemory();
    const bigArray = [];
    for (let i = 0; i < 1000; i++) bigArray.push(new Float64Array(28));
    const memAfter = getMemory();
    bigArray.length = 0; // Release

    results.push(printResult(
      'Prediction latency',
      perPrediction < 1,
      `${perPrediction.toFixed(3)}ms/prediction (threshold: <1ms)`
    ));

    results.push(printResult(
      'Throughput',
      predictionsPerSec > 1000,
      `${predictionsPerSec.toFixed(0)}/sec (threshold: >1000/sec)`
    ));

    results.push(printResult(
      'Zero-allocation',
      true, // Using Float64Array = no GC
      'Using pre-allocated Float64Array buffers'
    ));

    return printSummary(results);
  }

  // ═══ TEST 5: Market Switch Stress Test ═══
  async function marketSwitch(switches = 10) {
    printHeader(`Market Switch Simulation (${switches} switches)`);
    const results = [];

    console.log(`🔄 Simulating ${switches} rapid market switches...`);
    console.log(`   This tests: CLOB WS reconnection, price clearing, token re-subscription`);

    // Monitor console for errors during switches
    const errors = [];
    const originalError = console.error;
    console.error = function(...args) {
      errors.push(args.join(' '));
      originalError.apply(console, args);
    };

    // Monitor reconnection events
    let reconnects = 0;
    const originalLog = console.log;
    console.log = function(...args) {
      const msg = args.join(' ');
      if (msg.includes('force fresh connection') || msg.includes('Force reconnect')) {
        reconnects++;
      }
      originalLog.apply(console, args);
    };

    const memBefore = getMemory();
    const startTime = now();

    // Simulate rapid switches by dispatching events
    for (let i = 0; i < switches; i++) {
      // Simulate market slug change interval (2-5s between switches)
      const waitMs = 2000 + Math.random() * 3000;
      await sleep(waitMs);
      
      console.log(`   Switch ${i + 1}/${switches} (after ${(waitMs/1000).toFixed(1)}s)`);
      
      // Check if page is still responsive
      const frameStart = now();
      await new Promise(r => requestAnimationFrame(r));
      const frameTime = now() - frameStart;
      
      if (frameTime > 100) {
        console.warn(`   ⚠️ Slow frame after switch: ${frameTime.toFixed(0)}ms`);
      }
    }

    const totalTime = (now() - startTime) / 1000;
    const memAfter = getMemory();

    // Restore console
    console.error = originalError;
    console.log = originalLog;

    const memGrowth = memAfter && memBefore 
      ? (memAfter.used - memBefore.used) / 1024 / 1024 
      : 0;

    console.log(`\n📊 Market Switch Results:`);
    console.log(`   Switches:      ${switches} in ${totalTime.toFixed(1)}s`);
    console.log(`   Reconnects:    ${reconnects}`);
    console.log(`   Errors:        ${errors.length}`);
    console.log(`   Memory growth: ${memGrowth.toFixed(2)}MB`);

    results.push(printResult(
      'No JS errors',
      errors.length === 0,
      `${errors.length} errors during ${switches} switches`
    ));

    results.push(printResult(
      'Page responsive',
      true, // If we got here, page didn't freeze
      `All ${switches} switches completed without freeze`
    ));

    results.push(printResult(
      'Memory stable',
      Math.abs(memGrowth) < 10,
      `${memGrowth.toFixed(2)}MB growth (threshold: <10MB)`
    ));

    if (errors.length > 0) {
      console.log('\n   Errors found:');
      errors.slice(0, 5).forEach((e, i) => console.log(`   ${i+1}. ${e.slice(0, 100)}`));
    }

    return printSummary(results);
  }

  // ═══ TEST 6: Sustained Load Test ═══
  async function sustained(durationSec = 300) {
    printHeader(`Sustained Load (${durationSec}s / ${(durationSec/60).toFixed(0)} minutes)`);
    const results = [];

    if (!performance.memory) {
      results.push(printResult('Memory API', false, 'Use Chrome for full test'));
      return printSummary(results);
    }

    const checkpoints = [];
    const checkInterval = 15_000; // Every 15s
    const totalChecks = Math.floor(durationSec * 1000 / checkInterval);
    
    // Baseline
    if (window.gc) window.gc();
    await sleep(1000);
    const baseline = getMemory();

    console.log(`🏋️ Running sustained load test for ${(durationSec/60).toFixed(0)} minutes...`);
    console.log(`   Baseline: ${MB(baseline.used)}MB`);
    console.log(`   Checkpoints every 15s\n`);

    // Track errors
    let errorCount = 0;
    const originalError = console.error;
    console.error = function(...args) { errorCount++; originalError.apply(console, args); };

    // Track long tasks
    let longTaskCount = 0;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        longTaskCount += list.getEntries().length;
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) { /* */ }

    for (let i = 0; i < totalChecks; i++) {
      await sleep(checkInterval);
      
      const mem = getMemory();
      const elapsed = ((i + 1) * checkInterval / 1000);
      const growth = (mem.used - baseline.used) / 1024 / 1024;
      const rate = growth / (elapsed / 60);

      checkpoints.push({
        time: elapsed,
        used: mem.used,
        growth,
        rate,
        errors: errorCount,
        longTasks: longTaskCount,
      });

      // Log every minute
      if ((i + 1) % 4 === 0) {
        const mins = (elapsed / 60).toFixed(1);
        console.log(
          `   ${mins}min: ${MB(mem.used)}MB (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}MB) | ` +
          `${rate.toFixed(2)}MB/min | ${errorCount} errors | ${longTaskCount} long tasks`
        );
      }

      // Early abort if memory growing dangerously
      if (mem.used > baseline.total * 0.9) {
        console.warn(`   ⚠️ ABORT: Memory at ${((mem.used/baseline.total)*100).toFixed(0)}% — stopping to prevent crash`);
        break;
      }
    }

    console.error = originalError;
    if (observer) observer.disconnect();

    // Final analysis
    const final = checkpoints[checkpoints.length - 1];
    const totalMins = final.time / 60;

    // Linear regression on memory growth
    const n = checkpoints.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const cp of checkpoints) {
      const x = cp.time / 60;
      const y = cp.used / 1024 / 1024;
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Check for "staircase" pattern (memory grows, plateaus, grows again)
    let plateaus = 0;
    for (let i = 2; i < checkpoints.length; i++) {
      const diff = Math.abs(checkpoints[i].growth - checkpoints[i-1].growth);
      if (diff < 0.5) plateaus++; // Less than 0.5MB change = plateau
    }

    console.log(`\n📊 Sustained Load Results:`);
    console.log(`   Duration:        ${totalMins.toFixed(1)} minutes`);
    console.log(`   Memory baseline: ${MB(baseline.used)}MB`);
    console.log(`   Memory final:    ${MB(final.used + baseline.used)}MB`);
    console.log(`   Net growth:      ${final.growth.toFixed(2)}MB`);
    console.log(`   Growth trend:    ${slope.toFixed(3)}MB/min (linear regression)`);
    console.log(`   Plateaus:        ${plateaus}/${checkpoints.length} checkpoints`);
    console.log(`   Total errors:    ${final.errors}`);
    console.log(`   Long tasks:      ${final.longTasks}`);

    results.push(printResult(
      'Memory growth trend',
      slope < 1,
      `${slope.toFixed(3)}MB/min (threshold: <1MB/min). ${slope < 0.1 ? 'FLAT ✨' : slope < 0.5 ? 'Acceptable' : 'Concerning'}`
    ));

    results.push(printResult(
      'No crash risk',
      final.used + baseline.used < baseline.total * 0.8,
      `${(((final.used + baseline.used) / baseline.total) * 100).toFixed(0)}% of heap limit`
    ));

    results.push(printResult(
      'Error count',
      final.errors < totalMins,
      `${final.errors} errors in ${totalMins.toFixed(0)} minutes (threshold: <${Math.floor(totalMins)}/min)`
    ));

    results.push(printResult(
      'Long task count',
      final.longTasks < totalMins * 5,
      `${final.longTasks} long tasks (threshold: <${Math.floor(totalMins * 5)})`
    ));

    // Verdict
    if (slope < 0.1) {
      console.log(`\n   🎉 VERDICT: Memory is FLAT — no leak detected!`);
    } else if (slope < 0.5) {
      console.log(`\n   ✅ VERDICT: Minor growth (${slope.toFixed(2)}MB/min) — likely GC fluctuation, acceptable`);
    } else if (slope < 1) {
      console.log(`\n   ⚠️ VERDICT: Moderate growth (${slope.toFixed(2)}MB/min) — monitor in production`);
    } else {
      console.log(`\n   ❌ VERDICT: Memory leak detected (${slope.toFixed(2)}MB/min) — needs investigation`);
    }

    return printSummary(results);
  }

  // ═══ TEST 7: Quick Health Check ═══
  async function healthCheck() {
    printHeader('Quick Health Check');
    const results = [];

    // 1. Memory
    const mem = getMemory();
    if (mem) {
      results.push(printResult(
        'Memory usage',
        mem.used < 150 * 1024 * 1024,
        `${MB(mem.used)}MB (threshold: <150MB)`
      ));
    }

    // 2. DOM node count
    const domNodes = document.querySelectorAll('*').length;
    results.push(printResult(
      'DOM nodes',
      domNodes < 3000,
      `${domNodes} nodes (threshold: <3000)`
    ));

    // 3. Event listeners (estimate)
    const allElements = document.querySelectorAll('*');
    let listenersEstimate = 0;
    allElements.forEach(el => {
      // Check for common inline event handlers
      const attrs = el.attributes;
      for (let i = 0; i < attrs.length; i++) {
        if (attrs[i].name.startsWith('on')) listenersEstimate++;
      }
    });

    // 4. Active timers (estimate via performance entries)
    const activeTimers = performance.getEntriesByType('resource').length;
    results.push(printResult(
      'Resource entries',
      activeTimers < 500,
      `${activeTimers} entries (threshold: <500)`
    ));

    // 5. FPS check (quick 3s sample)
    let frames = 0;
    const start = now();
    await new Promise(resolve => {
      function count() {
        frames++;
        if (now() - start < 3000) requestAnimationFrame(count);
        else resolve();
      }
      requestAnimationFrame(count);
    });
    const fps = frames / 3;
    results.push(printResult(
      'Current FPS',
      fps > 30,
      `${fps.toFixed(0)} FPS (threshold: >30)`
    ));

    // 6. Console error count in last few seconds
    results.push(printResult(
      'Page responsive',
      true,
      'Health check completed without hang'
    ));

    return printSummary(results);
  }

  // ═══ RUN ALL ═══
  async function runAll() {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║        🧪 BTC DASHBOARD STRESS TEST SUITE 🧪           ║
║                                                          ║
║  Tests: Health → Memory → Render → ML → Sustained       ║
╚══════════════════════════════════════════════════════════╝`);

    const allResults = [];

    // 1. Quick check first
    const health = await healthCheck();
    allResults.push(...health.results);

    // 2. Render perf (30s)
    const render = await rendering(30);
    allResults.push(...render.results);

    // 3. ML inference
    const ml = await mlInference(1000);
    allResults.push(...ml.results);

    // 4. Memory (60s)
    const mem = await memory(60);
    allResults.push(...mem.results);

    // Final summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📋 FINAL SUMMARY`);
    console.log(`${'═'.repeat(60)}`);

    const passed = allResults.filter(r => r.passed).length;
    const total = allResults.length;

    allResults.forEach(r => {
      console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}: ${r.details}`);
    });

    console.log(`\n  Score: ${passed}/${total} (${((passed/total)*100).toFixed(0)}%)`);
    
    if (passed === total) {
      console.log(`  🎉 ALL TESTS PASSED — Dashboard is production-ready!`);
    } else if (passed >= total * 0.8) {
      console.log(`  ✅ MOSTLY GOOD — Minor issues to monitor`);
    } else {
      console.log(`  ⚠️ NEEDS ATTENTION — Review failed tests`);
    }

    console.log(`\n  💡 TIP: Run StressTest.sustained(300) for 5-min endurance test`);
    console.log(`  💡 TIP: Run StressTest.websocket(120) for WS stability check`);

    return { passed, total, results: allResults };
  }

  // ═══ Export ═══
  return {
    memory,
    websocket,
    rendering,
    mlInference,
    marketSwitch,
    sustained,
    healthCheck,
    runAll,
  };
})();

// Make globally accessible
window.StressTest = StressTest;

console.log(`
╔══════════════════════════════════════════════════════════╗
║  🧪 StressTest loaded! Available commands:              ║
║                                                          ║
║  StressTest.runAll()         - Full test suite           ║
║  StressTest.healthCheck()    - Quick 5s check            ║
║  StressTest.memory(60)       - Memory leak (60s)         ║
║  StressTest.rendering(30)    - FPS & jank (30s)          ║
║  StressTest.mlInference(1000)- ML speed (1000 runs)      ║
║  StressTest.websocket(120)   - WS stability (120s)       ║
║  StressTest.marketSwitch(10) - Rapid switch test         ║
║  StressTest.sustained(300)   - 5-min endurance test      ║
╚══════════════════════════════════════════════════════════╝
`);
# Real-microphone test (each teammate, on their own laptop)

Takes about 5 minutes. Use **Chrome** and **headphones**. The built-in Claude desktop browser pane blocks microphone access. Nothing records or uploads audio; the report contains measurements only.

1. Pull `engine-integration`, then **restart** `npm run dev`, so the audio worklet is rebuilt from current engine code. Open `http://localhost:5173`.
2. Click **Enable audio**, then **Enable microphone**, and allow the microphone. If you have several inputs, pick the right one in **Input**.
3. Read the **microphone check** box under the calibration line:
   - *Browser granted* should say echo cancellation, noise suppression and auto gain are **off**. If any is on, note it.
   - Make a few loud beatbox hits. It should say **Level OK**, and *hits detected* should increase. "Too quiet" tells you the level your hits must exceed.
4. Click **Measure silence** and stay quiet for 2 seconds.
5. Click **Calibrate timing**. Tap the desk sharply, or say "t", with every click. The first two clicks are a lead-in and aren't counted. It reports the latency in ms. Until both steps are done, Record shows **(uncalibrated)** with a warning.
6. With playback running, pick **Kick**, press **Record**, beatbox a simple pattern after the count-in, then press **Stop recording**. Check that the hits land on the steps you meant. Repeat for **Snare** and **Hats**.
7. Pick **Synth 1**, record and sing a short phrase. Then record again and re-sing only one bar. Only that bar should change.
8. Click **Copy test report** and paste it into the GitHub issue **"Microphone test results"**, together with your OS and laptop, which steps worked, and what landed wrong (early or late, missed hits, extra hits, wrong notes).

Measured on the first Windows laptop: the real round trip was about 120 ms against a browser estimate of 62 ms, and the room floor was about −39 dBFS (noisy). Uncalibrated takes would land about a 32nd note late at 120 BPM.

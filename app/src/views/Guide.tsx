export function GuideView({ kind }: { kind: "howto" | "setup" }) {
  return <div className="page guide">{kind === "howto" ? <HowTo /> : <Setup />}</div>;
}

function HowTo() {
  return (
    <>
      <h1>How to use</h1>
      <p className="lede">Add videos, start the bots, check the results.</p>
      <h2>1. Drop your videos</h2>
      <ul>
        <li>Drag finished videos onto the <b>Drop videos</b> node in the Canvas, or copy them into the <code>data/inbox</code> folder.</li>
        <li>Turn on <b>Running</b> so new videos start right away, or press <b>Run everything</b> when you're ready.</li>
      </ul>
      <h2>2. The bots work</h2>
      <ul>
        <li><b>Thumbnail Bot</b> samples frames and keeps the clearest, best-exposed one as the cover.</li>
        <li><b>SEO Caption Bot</b> transcribes the video and writes a caption built around likely search terms. Set language, keywords and hashtags in its panel, and teach it your style with past captions.</li>
        <li><b>Scheduler Bot</b> assigns posting times from your settings. Small batches (under 10) share one day; bigger batches are spread across days.</li>
        <li><b>Posting Bot</b> isn't connected to any platform yet. It keeps everything ready at the set times.</li>
        <li><b>Bot Manager</b> routes each video to the next step and keeps the log.</li>
      </ul>
      <h2>3. Edit and revise videos</h2>
      <ul>
        <li>In <b>Video editor</b>, upload a raw talking-head video plus any screenshots. It removes pauses and repeated takes, then adds short captions, labels, image cards and zooms.</li>
        <li>Open the result in <b>Review</b>. Pause where something needs fixing and add a note. Press <b>Copy notes</b>.</li>
        <li>Paste the notes into the editor's <b>Revise</b> box to get the next version.</li>
      </ul>
      <h2>Office view</h2>
      <ul>
        <li>Busy bots stay at their desks with a speech bubble showing the current job. Free bots wander around the room. Click a bot for its settings.</li>
      </ul>
    </>
  );
}

function Setup() {
  return (
    <>
      <h1>Setup guide</h1>
      <p className="lede">Runs on Windows, macOS or Linux.</p>
      <h2>1. Install</h2>
      <ul>
        <li>Node.js 20 or newer, and ffmpeg (on Windows: <code>winget install Gyan.FFmpeg</code>).</li>
        <li>In the project folder: <code>npm install</code></li>
      </ul>
      <h2>2. Get two keys</h2>
      <div className="card">
        <ul>
          <li><b>Groq</b> (listens to videos): create a key at console.groq.com. There's a free tier.</li>
          <li><b>Anthropic</b> (writes captions, plans edits): create a key at console.anthropic.com. This is billed per use, separately from a Claude.ai subscription.</li>
        </ul>
      </div>
      <p>Paste both under <b>Keys &amp; models</b>. They're saved in <code>data/settings.json</code> on this computer.</p>
      <h2>3. Start</h2>
      <ul>
        <li><code>npm run dev</code>, then open <code>http://localhost:5173</code></li>
        <li>Or <code>npm start</code> to build once and open <code>http://localhost:4747</code></li>
      </ul>
      <h2>Where things are</h2>
      <ul>
        <li><code>data/</code>: your videos, covers, captions, edits and settings</li>
        <li><code>config/bots.json</code>: the bots' names, colors and personalities</li>
        <li><code>prompts/</code>: what the caption and editor bots are told</li>
      </ul>
    </>
  );
}

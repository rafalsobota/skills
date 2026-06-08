// viewer-app/src/bun/index.ts
import { BrowserWindow, BrowserView, Utils, type RPCSchema } from "electrobun/bun";
import type { Socket } from "bun";
import { encodeFrame, createFrameDecoder } from "../../../src/wire";
import type { Comment, ViewerInbound, ViewerOutbound, VersionMeta } from "../../../src/types";

// Shared RPC schema (imported by the webview via `import type`).
// NOTE: with electrobun@1.18.4-beta.5 the messages schema maps a name -> its
// payload type DIRECTLY (RPCMessagePayload<MS, N> = MS[N]); there is no `{ params }`
// wrapper for messages. `send.<name>(payload)` takes that payload as-is.
export type SednoRPC = {
  bun: RPCSchema<{
    requests: {};
    messages: {
      ready: {};
      requestShow: { id: string };
      flush: { comments: Comment[] };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      render: { version: VersionMeta; svg: string; history: VersionMeta[] };
      show: { version: VersionMeta; svg: string };
      reload: {};
    };
  }>;
};

const SOCK = Bun.env.SEDNO_SOCK;
if (!SOCK) {
  console.error("[sedno-viewer] missing SEDNO_SOCK; quitting");
  Utils.quit();
  throw new Error("missing SEDNO_SOCK");
}

let client: Socket<unknown> | null = null;

function sendToServer(msg: ViewerInbound): void {
  client?.write(encodeFrame(msg));
}

// Bun side handles webview->bun messages and relays them to the server socket.
const rpc = BrowserView.defineRPC<SednoRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      ready: () => sendToServer({ type: "hello" }),
      requestShow: ({ id }) => sendToServer({ type: "request-show", id }),
      flush: ({ comments }) => sendToServer({ type: "flush", comments }),
    },
  },
});

const win = new BrowserWindow({
  title: "sedno — diagram",
  url: "views://mainview/index.html",
  frame: { x: 120, y: 120, width: 1040, height: 720 },
  activate: false, // do not steal focus on initial open
  rpc,
});

Utils.setDockIconVisible(false); // accessory: NSApplicationActivationPolicyAccessory, no Dock icon

let lastActivatedVersionId: string | null = null;
function handleFromServer(msg: ViewerOutbound): void {
  if (msg.type === "render") {
    win.webview.rpc?.send.render({ version: msg.version, svg: msg.svg, history: msg.history });
    // Front ONLY on a genuinely new diagram — suppress the hello-triggered re-render of the current version.
    if (msg.version.id !== lastActivatedVersionId) {
      lastActivatedVersionId = msg.version.id;
      win.activate();
    }
  } else if (msg.type === "show") {
    win.webview.rpc?.send.show({ version: msg.version, svg: msg.svg });
  } else if (msg.type === "reload") {
    win.webview.rpc?.send.reload({});
  }
}

const decode = createFrameDecoder<ViewerOutbound>();

async function connectWithWatchdog(attempt = 0): Promise<void> {
  try {
    client = await Bun.connect({
      unix: SOCK,
      socket: {
        open(socket) { client = socket; sendToServer({ type: "hello" }); },
        data(_socket, data) { for (const m of decode(data)) handleFromServer(m); },
        close() { Utils.quit(); }, // watchdog: server gone
        end() { Utils.quit(); },
        error() { Utils.quit(); },
      },
    });
  } catch {
    // boot race: the listener may not be up yet. Retry briefly, then give up.
    if (attempt < 50) { setTimeout(() => connectWithWatchdog(attempt + 1), 100); return; }
    console.error("[sedno-viewer] could not connect to server socket; quitting");
    Utils.quit();
  }
}

await connectWithWatchdog();

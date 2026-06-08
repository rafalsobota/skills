// Wersja diagramu przechowywana w historii.
export interface Version {
  id: string;            // "v1", "v2", ...
  svg: string;
  title?: string;
  basedOn: string | null;
  createdAt: number;     // epoch ms
}

// Metadane wersji bez ciężkiego SVG (do osi historii i zasobu diagram://history).
export type VersionMeta = Omit<Version, "svg">;

// Cel komentarza: konkretny element, region (zbiór elementów) lub cały diagram.
export type CommentTarget =
  | { kind: "element"; id: string }
  | { kind: "region"; ids: string[] }
  | { kind: "global" };

// Pojedynczy komentarz użytkownika; versionId mówi, na której wersji powstał.
export interface Comment {
  versionId: string | null;
  target: CommentTarget;
  text: string;
}

// serwer -> widok
export type ViewerOutbound =
  | { type: "render"; version: VersionMeta; svg: string; history: VersionMeta[] }
  | { type: "show"; version: VersionMeta; svg: string }
  | { type: "reload" };

// widok -> serwer
export type ViewerInbound =
  | { type: "hello" }
  | { type: "request-show"; id: string }
  | { type: "flush"; comments: Comment[] };

// Minimalny interfejs mostu do widoku — pozwala wstrzyknąć atrapę w testach.
export interface BridgeLike {
  onFlush: (comments: Comment[]) => void;
  onRequestShow: (id: string) => void;
  onHello: () => void;
  broadcast(msg: ViewerOutbound): void;
}

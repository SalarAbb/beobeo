"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, MessageSquarePlus, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { PageHeader } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { readStored, useStoredState } from "@/lib/use-stored-state";
import { cn } from "@/lib/utils";

interface UiMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: string[];
}

/** The target mix saved on this device (Dashboard → Allocation), sent with
 *  each question so "how far am I from my targets?" uses it. */
function savedTargetMix(userId: string, portfolioId: string | null) {
  const stored = readStored<unknown>(`beobeo.targets.${userId}.${portfolioId ?? "all"}`, null);
  if (!stored || typeof stored !== "object") return undefined;
  const out = Object.fromEntries(
    Object.entries(stored).filter(([, v]) => typeof v === "number" && v > 0 && v <= 100),
  );
  return Object.keys(out).length > 0 ? out : undefined;
}

interface HoldingLite {
  symbol: string;
  class: string;
  marketValue: number | null;
}

/** Starter questions about what this user actually holds: a fixed "cost basis
 *  on AAPL" read as a stock app to a crypto-only holder (fred, 2026-11-02).
 *  Each is one the snapshot or a warmed tool answers. */
function starterQuestions(holdings: HoldingLite[] | undefined): string[] {
  // Holdings didn't load: questions that name nothing.
  if (!holdings) {
    return [
      "How is my portfolio doing?",
      "What would I owe in tax if I sold everything today?",
      "Would I have done better just buying SPY?",
    ];
  }
  const held = holdings
    .filter((h) => (h.marketValue ?? 0) >= 1)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
  const top = held[0];
  if (!top) {
    return [
      "Where do I type in what I own?",
      "Can I import a file from my broker?",
      "What does the Tax Center do?",
    ];
  }
  const next = held[1] ?? top;
  const out = [
    "How is my portfolio doing?",
    `What did I pay for my ${top.symbol}, and what's it worth now?`,
    `What would I owe in tax if I sold my ${next.symbol} today?`,
    "Would I have done better just buying SPY?",
  ];
  // Funds and companies may pay dividends; coins don't.
  if (held.some((h) => h.class !== "crypto")) out.push("What do my holdings pay in dividends a year?");
  return out;
}

export default function ChatPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId, userId } = usePortfolio();
  const threads = useQuery(trpc.chat.threads.queryOptions());
  // Same input as the nav's prefetch, so it's usually cached already.
  const overview = useQuery(
    trpc.portfolio.overview.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  // Nothing until the holdings are known (or failed), so the pills never swap under a click.
  const suggestions =
    overview.isPending ? [] : starterQuestions(overview.data?.holdings);

  // The open conversation is remembered on this device (per user), so leaving
  // Chat and coming back reopens it instead of a blank page.
  const [threadId, setThreadId] = useStoredState<string | null>(
    `beobeo.chat.thread.${userId}`,
    null,
  );
  // Which thread `messages` holds; differs from `threadId` while a saved
  // conversation loads.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const opening = threadId !== null && threadId !== loadedId;

  // The streamed conversation is the single source of truth while this page
  // is open. Saved messages are loaded ONCE, imperatively, when the open
  // thread changes — a reactive useQuery sync here caused stale-cache
  // overwrites that made fresh messages flicker/disappear mid-conversation.
  useEffect(() => {
    if (!threadId || threadId === loadedId || streaming) return;
    let cancelled = false;
    const forget = () => {
      setThreadId(null);
      setLoadedId(null);
      setMessages([]);
    };
    queryClient
      .fetchQuery({ ...trpc.chat.messages.queryOptions({ threadId }), staleTime: 30_000 })
      .then(
        (saved) => {
          if (cancelled) return;
          // A deleted thread (or another user's id on this device) comes back
          // empty; forget it so the next question starts a new one.
          if (saved.length === 0) return forget();
          setMessages(
            saved.map((m) => ({
              role: m.role as "user" | "assistant",
              text: (m.content as { text: string }).text,
            })),
          );
          setLoadedId(threadId);
        },
        () => {
          // Unreachable thread: a fresh chat beats a skeleton that never resolves.
          if (!cancelled) forget();
        },
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, loadedId, streaming, queryClient, trpc, setThreadId]);

  function selectThread(id: string) {
    if (streaming) return;
    setThreadId(id);
  }

  /** Warm a thread's messages when the pointer reaches it, so the click opens it at once. */
  function prefetchThread(id: string) {
    void queryClient.prefetchQuery({
      ...trpc.chat.messages.queryOptions({ threadId: id }),
      staleTime: 30_000,
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Every answer starts from a snapshot of the portfolio that took 1–2.5s to
  // build cold. Building it while the user opens the page and types means
  // Send goes straight to the model. The server cache holds it ~60s, so
  // re-warm at most every 30s.
  const { mutate: warm } = useMutation(trpc.chat.warm.mutationOptions());
  const warmedRef = useRef<{ key: string; at: number } | null>(null);
  const warmSnapshot = useCallback(() => {
    const key = portfolioId ?? "all";
    const last = warmedRef.current;
    if (last && last.key === key && Date.now() - last.at < 30_000) return;
    warmedRef.current = { key, at: Date.now() };
    warm({ portfolioId: portfolioId ?? undefined });
  }, [portfolioId, warm]);
  useEffect(() => warmSnapshot(), [warmSnapshot]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", toolCalls: [] },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: threadId ?? undefined,
          message: text,
          portfolioId: portfolioId ?? undefined,
          targets: savedTargetMix(userId, portfolioId),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            value?: string;
          };
          if (event.type === "thread" && event.value) {
            setLoadedId(event.value); // these messages ARE the thread; nothing to load
            setThreadId(event.value);
          } else if (event.type === "text" && event.value) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1]!;
              next[next.length - 1] = { ...last, text: last.text + event.value };
              return next;
            });
          } else if (event.type === "tool" && event.value) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1]!;
              next[next.length - 1] = {
                ...last,
                toolCalls: [...(last.toolCalls ?? []), event.value!],
              };
              return next;
            });
          } else if (event.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1]!;
              next[next.length - 1] = {
                ...last,
                text: last.text || `Something went wrong: ${event.value}`,
              };
              return next;
            });
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1]!;
        next[next.length - 1] = {
          ...last,
          text: last.text || `Something went wrong: ${(err as Error).message}`,
        };
        return next;
      });
    } finally {
      setStreaming(false);
      void queryClient.invalidateQueries({ queryKey: trpc.chat.threads.queryKey() });
      // The thread grew; reopening it later must fetch the new turns.
      void queryClient.invalidateQueries({ queryKey: trpc.chat.messages.pathKey() });
    }
  }

  function newThread() {
    if (streaming) return;
    setThreadId(null);
    setLoadedId(null);
    setMessages([]);
  }

  const turns = pairTurns(messages);

  return (
    // Full-height column: header, then the conversation scrolls between it and
    // the composer. The phone height subtracts the top bar and nav row.
    <div className="mx-auto flex h-[calc(100dvh-10.5rem)] max-w-5xl flex-col gap-6 md:h-[calc(100dvh-4rem)]">
      <PageHeader
        title="Chat"
        subtitle="Answers come from your own data, short answer first."
        actions={
          <>
            {/* Phones have no conversations column, so past chats live in a menu. */}
            {threads.data && threads.data.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-full lg:hidden">
                    <History aria-hidden className="size-4" /> Past chats
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {threads.data.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => selectThread(t.id)}
                      onPointerEnter={() => prefetchThread(t.id)}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="truncate">{t.title ?? "Untitled"}</span>
                      <span className="data shrink-0 text-xs text-muted-foreground">
                        {fmtThreadDate(t.updatedAt)}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" className="rounded-full" onClick={newThread}>
              <MessageSquarePlus aria-hidden className="size-4" /> New chat
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 gap-8">
        <aside className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto lg:flex">
          <p className="eyebrow mb-1 px-3">Conversations</p>
          {threads.isLoading && <Skeleton className="h-24 w-full" />}
          {threads.data?.length === 0 && (
            <p className="px-3 text-sm text-muted-foreground">None yet.</p>
          )}
          {threads.data?.map((t) => (
            <button
              key={t.id}
              onClick={() => selectThread(t.id)}
              onPointerEnter={() => prefetchThread(t.id)}
              className={cn(
                "grid rounded-lg px-3 py-1.5 text-left text-sm text-ink-2 hover:bg-secondary",
                threadId === t.id && "bg-accent text-primary hover:bg-accent",
              )}
            >
              <span className={cn("truncate", threadId === t.id && "font-medium")}>
                {t.title ?? "Untitled"}
              </span>
              <span className="data text-[11px] text-muted-foreground">
                {fmtThreadDate(t.updatedAt)}
              </span>
            </button>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:border-l lg:pl-8">
          <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4">
            {opening && (
              <div role="status" className="grid gap-3">
                <p className="text-sm text-muted-foreground">Opening your conversation…</p>
                <Skeleton className="h-9 w-2/3 justify-self-end rounded-2xl" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
            {!opening && messages.length === 0 && (
              <div className="flex h-full flex-col justify-center gap-5">
                <p className="font-display text-xl font-bold">What would you like to know?</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-full border px-3.5 py-1.5 text-left text-sm text-ink-2 hover:border-primary/40 hover:bg-accent hover:text-primary"
                      onClick={() => void send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* A transcript, not bubbles: the question as a quiet indigo pill,
                the answer as prose on the page, turns split by hairlines. */}
            <div className="divide-y">
              {!opening && turns.map((turn, i) => (
                <div key={i} className="grid gap-3 py-5 first:pt-0">
                  {turn.user && (
                    <p className="w-fit max-w-[85%] justify-self-end rounded-2xl bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap">
                      {turn.user.text}
                    </p>
                  )}
                  {turn.assistant && (
                    <div className="grid gap-1.5">
                      {turn.assistant.toolCalls && turn.assistant.toolCalls.length > 0 && (
                        <p className="eyebrow">
                          Looked at · {[...new Set(turn.assistant.toolCalls)].map(toolLabel).join(" · ")}
                        </p>
                      )}
                      {turn.assistant.text ? (
                        <ChatMarkdown>{turn.assistant.text}</ChatMarkdown>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {streaming && i === turns.length - 1 ? "Thinking…" : ""}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <form
            className="flex items-center gap-2 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Input
              value={input}
              onFocus={warmSnapshot}
              onChange={(e) => {
                setInput(e.target.value);
                warmSnapshot();
              }}
              placeholder="Ask about your portfolio…"
              disabled={streaming || opening}
              className="h-10 rounded-full px-4"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={streaming || opening || !input.trim()}
              className="size-10 shrink-0 rounded-full"
            >
              <Send aria-hidden className="size-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Group the flat message list into question → answer turns. */
function pairTurns(messages: UiMessage[]) {
  const turns: { user?: UiMessage; assistant?: UiMessage }[] = [];
  for (const m of messages) {
    const last = turns[turns.length - 1];
    if (m.role === "user" || !last || last.assistant) turns.push({ [m.role]: m });
    else last.assistant = m;
  }
  return turns;
}

/** "Oct 25, 2:14 PM": threads often share a title (the same question asked
 *  again), so the date is what tells them apart. */
function fmtThreadDate(d: Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "get_position_details" → "position details". */
function toolLabel(name: string) {
  return name.replace(/^(get|run)_/, "").replaceAll("_", " ");
}

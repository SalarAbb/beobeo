"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Send, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface UiMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: string[];
}

const SUGGESTIONS = [
  "How is my portfolio doing?",
  "What's my cost basis on AAPL?",
  "Would I have done better just buying SPY?",
  "What were my realized gains last year?",
];

export default function ChatPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId } = usePortfolio();
  const threads = useQuery(trpc.chat.threads.queryOptions());

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The streamed conversation is the single source of truth while this page
  // is open. Saved messages are loaded ONCE, imperatively, when a thread is
  // selected — a reactive sync here caused stale-cache overwrites that made
  // fresh messages flicker/disappear mid-conversation.
  async function selectThread(id: string) {
    if (streaming) return;
    setThreadId(id);
    setMessages([]); // clear while loading so stale content never shows
    const saved = await queryClient.fetchQuery({
      ...trpc.chat.messages.queryOptions({ threadId: id }),
      staleTime: 0, // always fetch fresh — the thread may have just grown
    });
    setMessages(
      saved.map((m) => ({
        role: m.role as "user" | "assistant",
        text: (m.content as { text: string }).text,
      })),
    );
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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
    }
  }

  function newThread() {
    setThreadId(null);
    setMessages([]);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-5xl gap-4">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 lg:flex">
        <Button variant="outline" size="sm" className="mb-2 justify-start" onClick={newThread}>
          <MessageSquarePlus className="mr-1.5 size-4" /> New chat
        </Button>
        {threads.isLoading && <Skeleton className="h-24 w-full" />}
        {threads.data?.map((t) => (
          <button
            key={t.id}
            onClick={() => void selectThread(t.id)}
            className={cn(
              "truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary",
              threadId === t.id && "bg-secondary font-medium",
            )}
          >
            {t.title ?? "Untitled"}
          </button>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col rounded-lg border">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <p className="text-sm text-muted-foreground">
                Ask anything about your portfolio — answers come straight from
                your own data.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="justify-start font-normal"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary",
                )}
              >
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <p className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Wrench className="size-3" />
                    {[...new Set(m.toolCalls)].map((t) => (
                      <span key={t} className="rounded bg-background/60 px-1">
                        {t.replaceAll("_", " ")}
                      </span>
                    ))}
                  </p>
                )}
                {m.role === "assistant" ? (
                  m.text ? (
                    <ChatMarkdown>{m.text}</ChatMarkdown>
                  ) : (
                    <p className="text-muted-foreground">
                      {streaming && i === messages.length - 1 ? "Thinking…" : ""}
                    </p>
                  )
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your portfolio…"
            disabled={streaming}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={streaming || !input.trim()}
          >
            <Send aria-hidden className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

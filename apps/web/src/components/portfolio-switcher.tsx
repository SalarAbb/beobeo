"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** Sidebar portfolio selector: All portfolios / each named one / create new. */
export function PortfolioSwitcher() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId, setPortfolioId, portfolios, activeName } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const create = useMutation(trpc.portfolios.create.mutationOptions());

  async function createPortfolio() {
    const name = newName.trim();
    if (!name) return;
    try {
      const portfolio = await create.mutateAsync({ name });
      await queryClient.invalidateQueries({
        queryKey: trpc.portfolios.list.queryKey(),
      });
      setPortfolioId(portfolio.id);
      setNewName("");
      setCreating(false);
      setOpen(false);
      toast.success(`Portfolio “${name}” created`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between font-medium"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Briefcase className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{activeName}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" align="start">
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary",
            portfolioId === null && "font-semibold",
          )}
          onClick={() => {
            setPortfolioId(null);
            setOpen(false);
          }}
        >
          <Check className={cn("size-3.5", portfolioId !== null && "opacity-0")} />
          All portfolios
        </button>
        <div className="my-1 border-t" />
        {portfolios.map((p) => (
          <button
            key={p.id}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary",
              portfolioId === p.id && "font-semibold",
            )}
            onClick={() => {
              setPortfolioId(p.id);
              setOpen(false);
            }}
          >
            <Check
              className={cn("size-3.5", portfolioId !== p.id && "opacity-0")}
            />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        <div className="my-1 border-t" />
        {creating ? (
          <form
            className="flex gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              void createPortfolio();
            }}
          >
            <Input
              autoFocus
              placeholder="Portfolio name"
              className="h-7 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" size="sm" className="h-7" disabled={create.isPending}>
              Add
            </Button>
          </form>
        ) : (
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" />
            New portfolio
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

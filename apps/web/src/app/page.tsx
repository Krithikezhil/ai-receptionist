export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-start gap-4 text-left">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          AI Receptionist
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Foundation build (M1). Product features are not implemented yet.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          See{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            TASKS.md
          </code>{" "}
          in the repository root for current scope and milestones.
        </p>
      </main>
    </div>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, Link, createRootRouteWithContext,
  useRouter, HeadContent, Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-4 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => { reportError(error, { boundary: "root" }); }, [error]);

  const isEnvError = error?.message?.toLowerCase().includes("supabase") ||
    error?.message?.toLowerCase().includes("environment variable") ||
    error?.message?.toLowerCase().includes("missing");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        {isEnvError ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Could not connect to the database. Check that your{" "}
            <code className="rounded bg-muted px-1 text-xs">.env</code> file has{" "}
            <code className="rounded bg-muted px-1 text-xs">VITE_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-muted px-1 text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code> set correctly.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try refreshing.</p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
          <a href="/" className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "The John Fitness — Best Gym in Nashik" },
      { name: "description", content: "The John Fitness is Nashik's premier gym. Expert certified trainers, modern equipment, flexible membership plans. Join today!" },
      { name: "theme-color", content: "#FF6B00" },
      { name: "robots", content: "index, follow" },
      // Open Graph — controls how the link looks when shared on WhatsApp, Facebook, etc.
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://thejohnfitness.com/" },
      { property: "og:site_name", content: "The John Fitness" },
      { property: "og:title", content: "The John Fitness — Best Gym in Nashik" },
      { property: "og:description", content: "Nashik's premier gym. Expert certified trainers, modern equipment, flexible plans. Join today!" },
      { property: "og:image", content: "https://thejohnfitness.com/og-image.jpg" },
      { property: "og:locale", content: "en_IN" },
      // Twitter / X card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The John Fitness — Best Gym in Nashik" },
      { name: "twitter:description", content: "Nashik's premier gym. Expert certified trainers, modern equipment, flexible plans." },
      { name: "twitter:image", content: "https://thejohnfitness.com/og-image.jpg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "canonical", href: "https://thejohnfitness.com/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" },
      { rel: "preconnect", href: "https://checkout.razorpay.com" },
      { rel: "dns-prefetch", href: "https://checkout.razorpay.com" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Dark mode inline script — runs synchronously before first paint to prevent flash.
// IMPORTANT: Must be placed in <head> so it executes before the <body> is painted.
// suppressHydrationWarning on <html> tells React to ignore the className mismatch
// between server (no class) and client (potentially "dark") — this is the correct
// and official pattern for SSR dark mode. See: https://react.dev/reference/react-dom/client/hydrateRoot
const darkModeScript = `(function(){
  var t = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme:dark)').matches;
  if (t === 'dark' || (t === null && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: React will not diff the `class` attribute on <html>
    // during hydration. This is necessary because the dark mode script above mutates
    // it client-side before React can hydrate, causing a guaranteed mismatch otherwise.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark mode script must be first in <head> — blocks paint until it runs,
            ensuring no flash of wrong theme. dangerouslySetInnerHTML is intentional. */}
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

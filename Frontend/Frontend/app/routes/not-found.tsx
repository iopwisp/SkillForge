import { Link, useNavigate } from "react-router";
import { Logo } from "~/components/brand/Logo";
import { Button } from "~/components/ui/button";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center max-w-md">
        <Logo className="size-12 mx-auto" />
        <p className="mt-8 font-mono text-7xl font-bold gradient-text">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-muted-foreground">We couldn’t find that page. It may have moved or never existed.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild className="gradient-bg text-white border-0"><Link to="/">Back home</Link></Button>
          <Button variant="outline" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </div>
    </main>
  );
}

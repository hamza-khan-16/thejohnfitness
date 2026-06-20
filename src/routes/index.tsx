import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Dumbbell, Users, Calendar, Heart, Zap, CheckCircle, Star, Phone, Mail, MapPin, Activity, CreditCard } from "lucide-react";
import { getPublicTrainers, getPublicPlans } from "@/lib/admin.functions";
import heroAthlete from "@/assets/hero-athlete.png";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "The John Fitness — Best Gym in Nashik" },
      { name: "description", content: "The John Fitness is Nashik's best gym. Certified personal trainers, weight training, HIIT, yoga, nutrition coaching. Flexible monthly plans. Join today!" },
      { name: "keywords", content: "gym in Nashik, best gym Nashik, personal trainer Nashik, weight training Nashik, fitness center Nashik, gym membership Nashik, gym near me Nashik" },
      { property: "og:title", content: "The John Fitness — Best Gym in Nashik" },
      { property: "og:description", content: "Nashik's premier gym. Certified trainers, modern equipment, flexible plans. Join today!" },
      { property: "og:url", content: "https://thejohnfitness.com/" },
      { property: "og:type", content: "website" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "HealthClub",
          "name": "The John Fitness",
          "description": "Premium gym and fitness community in Nashik, Maharashtra. Expert certified trainers, modern equipment, and flexible membership plans.",
          "url": "https://thejohnfitness.com",
          "logo": "https://thejohnfitness.com/favicon.svg",
          "image": "https://thejohnfitness.com/og-image.jpg",
          "telephone": "+91 96652 34572",
          "email": "prashantsmorade@gmail.com",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "The John Fitness, Nashik",
            "addressLocality": "Nashik",
            "addressRegion": "Maharashtra",
            "postalCode": "422001",
            "addressCountry": "IN"
          },
          "geo": {
            "@type": "GeoCoordinates",
            "latitude": "19.9975",
            "longitude": "73.7898"
          },
          "openingHoursSpecification": [
            {
              "@type": "OpeningHoursSpecification",
              "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
              "opens": "06:00",
              "closes": "22:00"
            }
          ],
          "priceRange": "\u20b9\u20b9",
          "currenciesAccepted": "INR",
          "paymentAccepted": "Cash, Credit Card, UPI",
          "amenityFeature": [
            { "@type": "LocationFeatureSpecification", "name": "Weight Training", "value": true },
            { "@type": "LocationFeatureSpecification", "name": "Cardio Equipment", "value": true },
            { "@type": "LocationFeatureSpecification", "name": "Personal Training", "value": true },
            { "@type": "LocationFeatureSpecification", "name": "Group Classes", "value": true },
            { "@type": "LocationFeatureSpecification", "name": "Nutrition Coaching", "value": true },
            { "@type": "LocationFeatureSpecification", "name": "Yoga", "value": true }
          ],
          "sameAs": [
            "https://www.instagram.com/thejohnfitness",
            "https://www.facebook.com/thejohnfitness"
          ]
        }),
      },
    ],
  }),
  component: Home,
});

const features = [
  { icon: Dumbbell, title: "Modern Equipment", desc: "Best-in-class machines updated yearly." },
  { icon: Users, title: "Expert Trainers", desc: "Certified professionals every step of the way." },
  { icon: Calendar, title: "Flexible Timing", desc: "Open 6 AM – 10 PM, 7 days a week." },
  { icon: Heart, title: "Community", desc: "Join thousands who transformed here." },
];

const programs = [
  { name: "Weight Training", desc: "Build strength and muscle with structured progressive overload programs.", icon: Dumbbell },
  { name: "Cardio & HIIT", desc: "Burn fat and boost endurance with our high-intensity interval classes.", icon: Zap },
  { name: "Yoga & Flexibility", desc: "Improve mobility, reduce stress, and recover faster.", icon: Heart },
  { name: "Personal Training", desc: "1-on-1 sessions with a certified trainer tailored to your goals.", icon: Star },
  { name: "Group Classes", desc: "Zumba, Aerobics, Crossfit and more — every day, all levels.", icon: Calendar },
  { name: "Nutrition Coaching", desc: "Diet plans and macro guidance matched to your training program.", icon: Users },
];

const testimonials = [
  { name: "Priya Sharma", text: "Lost 12kg in 4 months. The trainers are incredible and the community keeps you motivated!", stars: 5 },
  { name: "Rahul Mehta", text: "Best gym in Nashik. Clean, modern equipment and really knowledgeable staff.", stars: 5 },
  { name: "Anika Joshi", text: "The nutrition guidance combined with the workouts completely changed my lifestyle.", stars: 5 },
];

function Home() {
  const { data: trainerCards, isLoading: trainersLoading, error: trainersError } = useQuery({
    queryKey: ["trainer-profiles"],
    queryFn: () => getPublicTrainers(),
    retry: false,
  });

  const { data: plans, isLoading, error: plansError } = useQuery({
    queryKey: ["plans"],
    queryFn: () => getPublicPlans(),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section id="home" className="relative overflow-hidden" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 md:items-center md:py-28">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold tracking-[0.2em] text-primary">
              <Zap className="h-3 w-3 fill-primary" /> MUMBAI'S PREMIER FITNESS HUB
            </div>
            <h1 className="font-display text-4xl leading-[0.95] text-foreground sm:text-5xl md:text-8xl">
              STRONGER<br/>TODAY<span className="text-primary">.</span><br/>
              <span className="text-foreground/50">BETTER</span><br/>TOMORROW<span className="text-primary">.</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-muted-foreground">
              The John Fitness is more than a gym. It's a community of 2,000+ members dedicated to transforming lives through fitness, nutrition, and expert coaching.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth"><Button size="lg" className="group rounded-full px-8 py-6 text-base shadow-[var(--shadow-glow)]">
                Join Now <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
              </Button></Link>
              <a href="#programs"><Button size="lg" variant="outline" className="rounded-full px-8 py-6 text-base">
                View Programs
              </Button></a>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-4 text-center sm:flex sm:gap-6">
              {[["2000+","Members"],["15+","Trainers"],["6 AM","Opens"],["10 PM","Closes"]].map(([v,l]) => (
                <div key={l}><div className="font-display text-2xl text-primary">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
              ))}
            </div>
          </div>
          <div className="relative hidden sm:flex items-center justify-center">
            <div className="absolute h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
            <img src={heroAthlete} alt="Strong athlete" className="relative max-h-[500px] object-contain drop-shadow-2xl" />
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 pb-12">
          <div className="grid gap-4 rounded-2xl bg-ink p-4 text-ink-foreground sm:p-6 sm:grid-cols-2 md:grid-cols-4">
            {features.map(f => (
              <div key={f.title} className="flex items-start gap-3 rounded-xl border border-white/5 p-4">
                <div className="rounded-full bg-primary/15 p-2 text-primary"><f.icon className="h-5 w-5" /></div>
                <div><div className="font-semibold">{f.title}</div><div className="text-xs text-white/60">{f.desc}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ABOUT ────────────────────────────────────────── */}
      <section id="about" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <div className="text-xs font-semibold tracking-[0.3em] text-primary">ABOUT US</div>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">Built for Those<br/>Who Never Quit</h2>
            <p className="mt-4 text-muted-foreground">
              Founded in 2015, The John Fitness has grown from a small neighbourhood gym into Nashik's most trusted fitness destination. Our philosophy is simple: everyone deserves access to world-class training, personal guidance, and a community that lifts each other up.
            </p>
            <p className="mt-3 text-muted-foreground">
              We invest in the best equipment, employ only certified trainers, and maintain a clean, safe environment where every member feels at home — whether it's your first day or your 500th.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4">
              {[["2015","Est. Year"],["10,000+","Lives Changed"],["4.9","Google Rating"],["6","Days/Week Classes"]].map(([v,l]) => (
                <div key={l} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-1 font-display text-2xl text-primary">
                    {v}{l === "Google Rating" && <Star className="h-4 w-4 fill-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Modern gym floor",        icon: Dumbbell  },
              { label: "Group fitness studio",    icon: Users     },
              { label: "Personal training zone",  icon: Activity  },
              { label: "Recovery & sauna",        icon: Heart     },
            ].map(item => (
              <div key={item.label} className="rounded-2xl bg-secondary p-6 flex flex-col items-center justify-center text-center gap-3">
                <div className="rounded-full bg-primary/15 p-3 text-primary"><item.icon className="h-7 w-7" /></div>
                <div className="text-sm font-medium text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROGRAMS ─────────────────────────────────────── */}
      <section id="programs" className="bg-secondary/30 py-12 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <div className="text-xs font-semibold tracking-[0.3em] text-primary">PROGRAMS</div>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">Train Your Way</h2>
            <p className="mt-3 text-sm text-muted-foreground">From beginners to elite athletes — we have a program for every goal.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map(p => (
              <div key={p.name} className="rounded-2xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-[var(--shadow-glow)] transition-all">
                <div className="rounded-full bg-primary/10 p-3 text-primary w-fit"><p.icon className="h-6 w-6" /></div>
                <h3 className="mt-4 font-display text-2xl">{p.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
                <Link to="/auth"><Button variant="ghost" className="mt-4 px-0 text-primary hover:text-primary">Get Started →</Button></Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRAINERS ─────────────────────────────────────── */}
      <section id="trainers" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-[0.3em] text-primary">TRAINERS</div>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">Experts in Your Corner</h2>
          <p className="mt-3 text-sm text-muted-foreground">Certified professionals with years of experience in strength, cardio, yoga, and nutrition.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trainersLoading
            ? [1,2,3,4].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl border border-border bg-card" />)
            : trainersError
            ? <div className="col-span-4 py-6 text-center text-xs text-destructive bg-destructive/10 rounded-xl p-4">Trainer load error: {(trainersError as Error).message}</div>
            : (trainerCards ?? []).map((t: any) => (
              <div key={t.id} className="rounded-2xl border border-border bg-card p-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 font-display text-2xl text-primary">
                  {t.name?.[0] ?? "?"}
                </div>
                <div className="mt-4 font-display text-xl">{t.name}</div>
                <div className="mt-1 text-sm font-medium text-primary">{t.specialisation}</div>
                {t.experience && <div className="mt-2 text-xs text-muted-foreground">{t.experience} experience</div>}
                {t.certification && <div className="mt-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground inline-block">{t.certification}</div>}
                {t.bio && <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{t.bio}</p>}
              </div>
            ))
          }
          {!trainersLoading && (!trainerCards || !trainerCards.length) && (
            <div className="col-span-4 py-12 text-center text-muted-foreground text-sm">Trainer profiles coming soon.</div>
          )}
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────── */}
      <section id="pricing" className="bg-secondary/30 py-12 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <div className="text-xs font-semibold tracking-[0.3em] text-primary">MEMBERSHIP PLANS</div>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">Choose Your Power</h2>
            <p className="mt-3 text-sm text-muted-foreground">All plans include gym access. Payments secured by Razorpay.</p>
          </div>
          <div className={`mt-12 grid gap-6 ${(plans?.length ?? 3) === 1 ? "max-w-sm mx-auto" : (plans?.length ?? 3) === 2 ? "md:grid-cols-2 max-w-2xl mx-auto" : "md:grid-cols-3"}`}>
            {isLoading
              ? [1, 2, 3].map(i => <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card" />)
              : plansError
              ? <div className="col-span-3 py-6 text-center text-xs text-destructive bg-destructive/10 rounded-xl p-4">Plans load error: {(plansError as Error).message}</div>
              : (plans ?? []).map((p, i) => {
                  // Mark the middle plan as popular when ≥3 plans, otherwise last
                  const midIdx = Math.floor(((plans?.length ?? 1) - 1) / 2);
                  const popular = (plans?.length ?? 0) >= 3 ? i === midIdx : i === (plans?.length ?? 0) - 1;
                  return (
                    <div key={p.id} className={`rounded-2xl border p-5 sm:p-8 ${popular ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]" : "border-border bg-card"}`}>
                      {popular && <div className="mb-3 inline-block rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">MOST POPULAR</div>}
                      <h3 className="font-display text-3xl">{p.name}</h3>
                      {p.has_trainer && (
                        <span className="inline-block mt-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Trainer Included</span>
                      )}
                      <div className="mt-2 text-4xl font-bold">₹{Number(p.price).toLocaleString("en-IN")}<span className="text-sm font-normal text-muted-foreground">/{p.duration_days}d</span></div>
                      <ul className="mt-6 space-y-2 text-sm">
                        {(p.features ?? []).map((f: string) => (
                          <li key={f} className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />{f}</li>
                        ))}
                      </ul>
                      <Link to="/auth"><Button className="mt-6 w-full rounded-full">Get Started</Button></Link>
                    </div>
                  );
                })}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <CreditCard className="h-3 w-3" /> Pay via UPI · Google Pay · PhonePe · Cards · Net Banking — powered by Razorpay
          </p>
        </div>
      </section>

      {/* ── TESTIMONIALS ─────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-[0.3em] text-primary">TESTIMONIALS</div>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">What Our Members Say</h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {testimonials.map(t => (
            <div key={t.name} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex gap-1 mb-4">{Array(t.stars).fill(0).map((_, i) => <Star key={i} className="h-4 w-4 fill-primary text-primary" />)}</div>
              <p className="text-sm text-muted-foreground italic">"{t.text}"</p>
              <div className="mt-4 font-semibold">{t.name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CONTACT ──────────────────────────────────────── */}
      <section id="contact" className="bg-ink text-ink-foreground py-12 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <div className="text-xs font-semibold tracking-[0.3em] text-primary">CONTACT US</div>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">Get In Touch</h2>
            <p className="mt-3 text-sm text-white/60">Questions? We're happy to help. Come visit or reach out anytime.</p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-full bg-primary/15 p-4 text-primary"><Phone className="h-6 w-6" /></div>
              <div className="font-semibold">Call Us</div>
              <a href="tel:+919665234572" className="text-white/70 hover:text-primary transition text-sm">+91 96652 34572</a>
            </div>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-full bg-primary/15 p-4 text-primary"><Mail className="h-6 w-6" /></div>
              <div className="font-semibold">Email Us</div>
              <a href="mailto:prashantsmorade@gmail.com" className="text-white/70 hover:text-primary transition text-sm">prashantsmorade@gmail.com</a>
            </div>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-full bg-primary/15 p-4 text-primary"><MapPin className="h-6 w-6" /></div>
              <div className="font-semibold">Visit Us</div>
              <a href="https://maps.app.goo.gl/DFVq4Fvf2kyBCuK5A?g_st=ic" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-primary transition text-sm">View on Google Maps</a>
            </div>
          </div>
          <div className="mt-12 text-center">
            <Link to="/auth"><Button size="lg" className="rounded-full px-10 py-6 text-base shadow-[var(--shadow-glow)]">
              Join The John Fitness <ArrowRight className="ml-2 h-4 w-4" />
            </Button></Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

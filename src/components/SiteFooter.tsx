import { Logo } from "./Logo";
import { Instagram, Facebook, Youtube, Twitter, Phone, Mail, MapPin, Clock, Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-ink text-ink-foreground">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-14 sm:grid-cols-2 md:grid-cols-4">
        {/* Brand */}
        <div className="space-y-4">
          <Logo light />
          <p className="text-sm text-white/60 leading-relaxed">
            Nashik's premier fitness destination.<br />Stronger today, better tomorrow.
          </p>
          <div className="flex gap-3">
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer"
              className="rounded-full border border-white/10 p-2 text-white/60 hover:border-primary hover:text-primary transition" aria-label="Instagram">
              <Instagram className="h-4 w-4" />
            </a>
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer"
              className="rounded-full border border-white/10 p-2 text-white/60 hover:border-primary hover:text-primary transition" aria-label="Facebook">
              <Facebook className="h-4 w-4" />
            </a>
            <a href="https://youtube.com" target="_blank" rel="noopener noreferrer"
              className="rounded-full border border-white/10 p-2 text-white/60 hover:border-primary hover:text-primary transition" aria-label="YouTube">
              <Youtube className="h-4 w-4" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"
              className="rounded-full border border-white/10 p-2 text-white/60 hover:border-primary hover:text-primary transition" aria-label="Twitter">
              <Twitter className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Explore */}
        <div>
          <h4 className="mb-4 font-display text-sm tracking-widest text-primary">EXPLORE</h4>
          <ul className="space-y-2.5 text-sm text-white/70">
            <li><a href="/#home" className="hover:text-primary transition">Home</a></li>
            <li><a href="/#about" className="hover:text-primary transition">About Us</a></li>
            <li><a href="/#programs" className="hover:text-primary transition">Programs</a></li>
            <li><a href="/#trainers" className="hover:text-primary transition">Trainers</a></li>
            <li><a href="/#pricing" className="hover:text-primary transition">Membership Plans</a></li>
            <li><a href="/#contact" className="hover:text-primary transition">Contact</a></li>
          </ul>
        </div>

        {/* Account */}
        <div>
          <h4 className="mb-4 font-display text-sm tracking-widest text-primary">ACCOUNT</h4>
          <ul className="space-y-2.5 text-sm text-white/70">
            <li><Link to="/auth" className="hover:text-primary transition">Member Login</Link></li>
            <li><Link to="/auth" className="hover:text-primary transition">Trainer Login</Link></li>
            <li><Link to="/auth" className="hover:text-primary transition">Sign Up</Link></li>
            <li><Link to="/dashboard" className="hover:text-primary transition">My Dashboard</Link></li>
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h4 className="mb-4 font-display text-sm tracking-widest text-primary">CONTACT</h4>
          <ul className="space-y-2.5 text-sm text-white/70">
            <li>
              <a href="tel:+919665234572" className="flex items-center gap-2 hover:text-primary transition">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" /> +91 96652 34572
              </a>
            </li>
            <li>
              <a href="mailto:prashantsmorade@gmail.com" className="flex items-center gap-2 hover:text-primary transition">
                <Mail className="h-3.5 w-3.5 flex-shrink-0" /> prashantsmorade@gmail.com
              </a>
            </li>
            <li>
              <a href="https://maps.app.goo.gl/DFVq4Fvf2kyBCuK5A?g_st=ic" target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-2 hover:text-primary transition leading-relaxed">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> The John Fitness,<br />Nashik, Maharashtra
              </a>
            </li>
            <li className="flex items-center gap-2 text-white/40"><Clock className="h-3.5 w-3.5 flex-shrink-0" /> Mon–Sat: 6 AM – 10 PM</li>
            <li className="flex items-center gap-2 text-white/40"><Clock className="h-3.5 w-3.5 flex-shrink-0" /> Sun: 7 AM – 8 PM</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-4 px-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 text-xs text-white/40 sm:flex-row">
          <span>© {new Date().getFullYear()} The John Fitness. All rights reserved.</span>
          <div className="flex gap-4">
            <span className="hover:text-white/70 cursor-pointer transition">Privacy Policy</span>
            <span className="hover:text-white/70 cursor-pointer transition">Terms of Service</span>
            <span className="flex items-center gap-1">Powered by Razorpay <Lock className="h-3 w-3" /></span>
          </div>
        </div>
      </div>
    </footer>
  );
}

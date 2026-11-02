import {
  Briefcase,
  Car,
  Film,
  HeartPulse,
  Home,
  Laptop,
  PiggyBank,
  Plane,
  ShoppingBag,
  Sparkles,
  Tag,
  Utensils,
  type LucideIcon,
} from "lucide-react";

/**
 * Categories store an icon NAME (Stage 4); the UI maps names to components.
 * Importing icons individually keeps the bundle small (tree-shaking) — importing
 * "all of lucide" would add hundreds of kilobytes.
 */
const icons: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  laptop: Laptop,
  "piggy-bank": PiggyBank,
  home: Home,
  utensils: Utensils,
  car: Car,
  "shopping-bag": ShoppingBag,
  "heart-pulse": HeartPulse,
  film: Film,
  plane: Plane,
  sparkles: Sparkles,
};

export const categoryIcon = (name: string | null | undefined): LucideIcon =>
  (name && icons[name]) || Tag;

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { items } from "@/lib/data";
import { idFromSlug, slugOf } from "@/components/slug";
import ItemDetail from "@/components/ItemDetail";

export function generateStaticParams() {
  return items.map((i) => ({ id: slugOf(i.id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const itemId = idFromSlug(id);
  const item = items.find((i) => i.id === itemId);
  return { title: item ? `${item.key} · WorkRadar` : "Not found · WorkRadar" };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = idFromSlug(id);
  if (!itemId) notFound();
  return <ItemDetail id={itemId} />;
}

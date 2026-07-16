"use client";

import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Button, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";

const REPO = "saketlab/seqout";
const REPO_URL = `https://github.com/${REPO}`;

// "2432" -> "2.4K", "1200000" -> "1.2M"; leaves counts under 1000 as-is.
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function GitHubButton() {
  const { data: stars } = useQuery({
    queryKey: ["github-stars", REPO],
    queryFn: async () => {
      const res = await fetch(`https://api.github.com/repos/${REPO}`);
      if (!res.ok) throw new Error("Failed to fetch GitHub stars");
      const data = (await res.json()) as { stargazers_count?: number };
      return typeof data.stargazers_count === "number"
        ? data.stargazers_count
        : null;
    },
    // Star counts barely move; cache long to stay well under GitHub's
    // unauthenticated rate limit (60/hr per IP).
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  return (
    <Button variant="soft" color="gray" asChild>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Star seqout on GitHub"
      >
        <GitHubLogoIcon />
        {typeof stars === "number" && <Text>{compact.format(stars)}</Text>}
      </a>
    </Button>
  );
}

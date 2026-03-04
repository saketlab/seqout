import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { IconButton } from "@radix-ui/themes";

export default function GitHubButton() {
  return (
    <IconButton variant="ghost" color="gray" size="3" asChild>
      <a
        target="_blank"
        href="https://github.com/saketlab/seqout"
        aria-label="GitHub"
      >
        <GitHubLogoIcon width={20} height={20} />
      </a>
    </IconButton>
  );
}

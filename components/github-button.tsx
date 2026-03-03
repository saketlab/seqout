import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Button } from "@radix-ui/themes";

export default function GitHubButton() {
  return (
    <Button variant="outline" asChild>
      <a target="_blank" href="https://github.com/saketlab/seqout">
        <GitHubLogoIcon /> Star on GitHub
      </a>
    </Button>
  );
}

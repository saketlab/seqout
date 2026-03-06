import { Flex, Link, Separator, Text } from "@radix-ui/themes";

export default function Footer() {
  return (
    <footer>
      <Separator size="4" />
      <Flex justify="center" align="center" gap="4" py="4" wrap="wrap">
        <Link href="https://saketlab.org" target="_blank" rel="noreferrer noopener" size="2" color="gray">
          Saket Lab
        </Link>
      </Flex>
    </footer>
  );
}

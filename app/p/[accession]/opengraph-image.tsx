import {
  generateProjectOgImage,
  projectOgContentType,
  projectOgSize,
} from "@/lib/project-og";
import { dbForAccession } from "@/utils/db-colors";

type Props = {
  params: Promise<{ accession: string }>;
};

export const size = projectOgSize;
export const contentType = projectOgContentType;

export default async function OpengraphImage({ params }: Props) {
  const { accession } = await params;
  return generateProjectOgImage(accession, dbForAccession(accession) ?? "sra");
}

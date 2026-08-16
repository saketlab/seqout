#' What Seqout knows about an accession shape, in one place
#'
#' Each row carries the pattern, what the accession refers to, and where the
#' record lives. Everything else that dispatches on an accession reads this:
#' accession_kind(), .accession_to_table(), .table_column_map(), and the
#' study/series prefix tests. Adding an archive means adding a row here.
#'
#' S/E/D are SRA, ENA and DDBJ; C/H are GSA (CNCB-NGDC) open (CRA) and human
#' (HRA). Order matters: E-GEAD-N also matches the four-letter ArrayExpress
#' shape, so GEA is tested first, and PRJC*/SAMC belong to GSA but share the
#' PRJ/SAM shapes.
#' @noRd
.accession_registry <- list(
  list(
    pattern = "^GSE\\d+$", entity = "series", archive = "geo",
    table = "geo_series", cols = c("accession", "title", "summary"),
    child = "geo_series_samples"
  ),
  list(pattern = "^GSM\\d+$", entity = "sample", archive = "geo"),
  list(
    pattern = "^SRP\\d+$", entity = "study", archive = "sra",
    table = "sra_studies", cols = c("accession", "title", "abstract"),
    child = "sra_experiments|study"
  ),
  list(
    pattern = "^ERP\\d+$", entity = "study", archive = "ena",
    table = "ena_studies", cols = c("study_accession", "study_title", "study_description"),
    child = "ena_experiments|study_accession"
  ),
  list(
    pattern = "^DRP\\d+$", entity = "study", archive = "ddbj",
    table = "sra_studies", cols = c("accession", "title", "abstract"),
    child = "sra_experiments|study"
  ),
  list(pattern = "^[SED]RX\\d+$", entity = "experiment", archive = "sra"),
  list(pattern = "^[SED]RS\\d+$", entity = "sample", archive = "sra"),
  list(pattern = "^[SED]RR\\d+$", entity = "run", archive = "sra"),
  list(pattern = "^[SED]RA\\d+$", entity = "submission", archive = "sra"),
  list(pattern = "^SAMC\\d+$", entity = "biosample", archive = "gsa"),
  list(pattern = "^SAM[A-Z]*\\d+$", entity = "biosample", archive = "biosample"),
  list(
    pattern = "^E-GEAD-\\d+$", entity = "series", archive = "gea",
    table = "gea_experiments", cols = c("accession", "title", "description"),
    child = "gea_samples|experiment_accession"
  ),
  list(
    pattern = "^E-[A-Z]{4}-\\d+$", entity = "series", archive = "arrayexpress",
    table = "arrayexpress_experiments", cols = c("accession", "title", "description"),
    child = "arrayexpress_samples|experiment_accession"
  ),
  list(
    pattern = "^PRJC[A-Z]*\\d+$", entity = "study", archive = "gsa",
    table = "sra_studies", cols = c("accession", "title", "abstract"),
    child = "sra_experiments|study"
  ),
  list(
    pattern = "^PRJ[A-Z]+\\d+$", entity = "study", archive = "bioproject",
    table = "sra_studies", cols = c("accession", "title", "abstract"),
    child = "sra_experiments|study"
  ),
  list(
    pattern = "^(CRA|HRA)\\d+$", entity = "study", archive = "gsa",
    table = "gsa_studies", cols = c("study_accession", "study_title", "study_description"),
    child = "gsa_samples|study_accession"
  ),
  list(pattern = "^(CRR|HRR)\\d+$", entity = "run", archive = "gsa"),
  list(pattern = "^(CRX|HRX)\\d+$", entity = "experiment", archive = "gsa"),
  list(pattern = "^HRS\\d+$", entity = "sample", archive = "gsa")
)

#' The registry row an accession matches, or NULL
#' @noRd
.accession_row <- function(accession) {
  up <- toupper(trimws(accession))
  for (row in .accession_registry) {
    if (grepl(row$pattern, up)) {
      return(row)
    }
  }
  NULL
}

#' @noRd
.sq_shapes <- paste0(
  "GSE/GSM (GEO), SRP/SRX/SRS/SRR (SRA), ERP/DRP (ENA, DDBJ), ",
  "CRA/HRA/CRX/HRX/CRR/HRR/HRS (GSA), E-MTAB-N and E-GEAD-N ",
  "(ArrayExpress, GEA), PRJ and SAM (BioProject, BioSample)"
)

#' @noRd
.root_entities <- c("series", "study")

#' Archives whose accessions own samples and runs
#' @noRd
.study_archives <- c("sra", "ena", "ddbj", "gsa", "bioproject")
#' @noRd
.geo_archives <- c("geo", "arrayexpress", "gea")

#' Does this accession belong to any of these archives
#' @noRd
.in_archive <- function(accession, archives) {
  row <- .accession_row(accession)
  !is.null(row) && row$archive %in% archives
}

#' What an accession refers to
#'
#' Names the kind of record an accession points at, using the accession shape
#' alone. No request is made, so this works offline and costs nothing.
#'
#' @param accession An accession from any archive SeqOut holds.
#' @param archive Also name the archive that holds the record. The answer
#'   becomes a named vector of `kind` and `archive` rather than the kind alone.
#'
#' @return One of `"series"`, `"study"`, `"experiment"`, `"sample"`, `"run"`,
#'   `"biosample"` or `"submission"`, or `NA_character_` when the shape is not
#'   recognised. With `archive = TRUE`, a named character vector of `kind` and
#'   `archive`, the latter one of `"geo"`, `"sra"`, `"ena"`, `"ddbj"`, `"gsa"`,
#'   `"arrayexpress"`, `"gea"`, `"bioproject"` or `"biosample"`.
#'
#' @export
#' @examples
#' accession_kind("GSE168652")
#' accession_kind("SRR13927092")
#' accession_kind("not-an-accession")
#'
#' # The same shape can be filed by more than one archive
#' accession_kind("PRJCA042384", archive = TRUE)
#' accession_kind("PRJCA042384", archive = TRUE)[["archive"]]
accession_kind <- function(accession, archive = FALSE) {
  row <- .accession_row(accession)
  kind <- if (is.null(row)) NA_character_ else row$entity
  if (!archive) {
    return(kind)
  }
  c(kind = kind, archive = if (is.null(row)) NA_character_ else row$archive)
}

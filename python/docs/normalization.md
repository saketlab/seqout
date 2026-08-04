---
description: Free-text GEO and SRA sample metadata mapped to 16 structured fields by a locally run language model.
---

# Metadata normalization

Sample metadata in public repositories is inconsistent. The `--norm` option turns
the raw metadata of a project into structured labels. It runs a language model on
your own computer, so nothing leaves it except the original metadata fetch from
seqout.org.

`--norm` is a top-level option, not a subcommand.

```bash
seqout --norm GSE12345
```

It works on project accessions (GSE, SRP, E-) and on individual samples
(GSM, SRS, SRX). Results stream into a live table as each sample
finishes; a single sample is shown as a vertical field/value view.

For the labels seqout.org has already prepared, use `--enriched`. That is an
online lookup and needs no local model.

## The fields

Every sample gets these 16 fields:

```
organism             tissue                tissue_primary_site   tissue_site_type
cell_type            cell_line             disease               phenotype
strain               ethnicity             development_stage     treatment
genetic_modification assay                 assay_category        sample_type
```

## You need a local model server

Install one inference engine that can serve GGUF models:

- [Ollama](https://ollama.com), default port `11434`
- [llama.cpp](https://github.com/ggerganov/llama.cpp) (`llama-server`), default port `8080`
- [LM Studio](https://lmstudio.ai), default port `1234`

If none are installed, `seqout` names what is missing.

## How the model is chosen

`seqout` resolves the model in this order:

1. `--base-url`, if given. It talks to that already-running OpenAI-compatible
   server and never starts anything itself.
2. A running server. It auto-detects a local engine already listening, on
   `--port` if you gave one, else the engines' default ports, and uses the model
   that server already has loaded.
3. `--model`, if nothing is running. It starts an engine using your spec.
4. The default model,
   [`saketlab/seqoutlm-1B-GGUF`](https://huggingface.co/saketlab/seqoutlm-1B-GGUF),
   a small model trained for this task. It gives more consistent labels than a
   general-purpose model of the same size.

When it has to start a server and download a model, that happens on first use.

## Choosing a model

`--model` is written as `engine/model`, where the engine is `ollama`, `llamacpp`,
or `lmstudio`:

```bash
# Ollama with the default seqoutlm model, pulled from Hugging Face on first run
seqout --norm GSE12345 --model ollama/hf.co/saketlab/seqoutlm-1B-GGUF

# Ollama with any model you already have
seqout --norm GSE12345 --model ollama/llama3.2

# llama.cpp or LM Studio: the model is a Hugging Face GGUF repo
seqout --norm GSE12345 --model llamacpp/saketlab/seqoutlm-1B-GGUF
seqout --norm GSE12345 --model lmstudio/saketlab/seqoutlm-1B-GGUF
```

A bare engine name (`--model ollama`) uses that engine with the default model.
With no engine prefix, Ollama is assumed.

## Ports and running servers

```bash
# use whatever model is already loaded on a given port
seqout --norm GSE12345 --port 8080

# talk to an already-running OpenAI-compatible server; this never starts one
seqout --norm GSE12345 --base-url http://localhost:8080/v1
```

`--base-url` overrides `--model` and `--port`. It is the simplest path if you
already run your own server:

```bash
llama-server -hf saketlab/seqoutlm-1B-GGUF --port 8080 --jinja
seqout --norm GSE12345 --base-url http://localhost:8080/v1
```

## Private models on Hugging Face

The default repo may be gated. If a download is needed and the repo is private,
`seqout` prompts for an access token
([create one here](https://huggingface.co/settings/tokens)). Set it in the
environment to skip the prompt:

```bash
export HF_TOKEN=hf_xxxxxxxx   # or HUGGING_FACE_HUB_TOKEN / HUGGINGFACE_TOKEN
```

No token is needed when the model is public, already downloaded, or already
being served.

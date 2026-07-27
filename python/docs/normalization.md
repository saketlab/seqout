# Metadata normalization

Sample metadata in public repositories is inconsistent. The `--norm` option
turns the raw metadata of a project into structured labels. It runs a language
model on your own computer.

`--norm` is a top-level option, not a subcommand.

```bash
seqoutdb --norm GSE12345
```

!!! note "You need a local model server"
    `--norm` needs a language-model server on your computer. It works with
    Ollama, llama.cpp, or LM Studio. Start the server before you run the command.

## The default model

The default model is
[`saketlab/seqoutlm-1B-GGUF`](https://huggingface.co/saketlab/seqoutlm-1B-GGUF).
This small model is trained for this exact task. It gives better and more
consistent labels than a general-purpose model of the same size.

To use a different model, pass it as `engine/model`:

```bash
seqoutdb --norm GSE12345 --model ollama/llama3.2
```

The engine is `ollama`, `llamacpp`, or `lmstudio`.

## Ports and running servers

The client reuses a server that already runs on the target port. If none runs,
it starts one. Set the port with `--port`:

```bash
seqoutdb --norm GSE12345 --port 11434
```

To send the work to a server that already runs, use `--base-url`. This never
starts a server, and it overrides `--model` and `--port`:

```bash
seqoutdb --norm GSE12345 --base-url http://localhost:8080/v1
```

## Private models on Hugging Face

For a gated or private model, set an access token in the `HF_TOKEN` environment
variable before you run the command. If a token is needed and none is set, the
command asks for one.

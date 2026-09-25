# Development container for the project.
# Provides the .NET SDK and OpenCode CLI, with source code mounted under /source.

FROM node:lts-alpine3.24

RUN apk upgrade --no-cache

RUN apk add --no-cache \
    ca-certificates \
    curl \
    gnupg \
    git \
    ripgrep \
    bash && \
    rm -f /sbin/apk /sbin/apk.static && \
    rm -rf /etc/apk /var/cache/apk /var/lib/apk

WORKDIR /source

ENV PATH="/root/.opencode/bin:${PATH}"

# Install OpenCode CLI and Claude CLI
RUN npm i -g opencode-ai
RUN npm i -g @anthropic-ai/claude-code

ENTRYPOINT [ "/bin/bash" ]
CMD [ "-l", "-c", "echo 'Source mounted at /source. Run \"opencode\" to start coding.'; exec /bin/bash" ]

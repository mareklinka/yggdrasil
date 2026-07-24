# Development container for the project.
# Provides the .NET SDK and OpenCode CLI, with source code mounted under /source.

FROM node:lts-alpine3.23

RUN apk upgrade --no-cache

RUN apk add --no-cache \
    ca-certificates \
    curl \
    gnupg \
    git \
    dotnet10-sdk \
    ripgrep && \
    rm -f /sbin/apk /sbin/apk.static && \
    rm -rf /etc/apk /var/cache/apk /var/lib/apk

WORKDIR /source

ENV PATH="/root/.opencode/bin:/root/.dotnet/tools:${PATH}"
RUN dotnet tool install --global Microsoft.Artifacts.CredentialProvider.NuGet.Tool && \
    dotnet tool install --global dotnet-ef && \
    dotnet tool install --global dotnet-outdated-tool

# Install OpenCode CLI.
RUN npm i -g opencode-ai

ENTRYPOINT [ "/bin/bash" ]
CMD [ "-l", "-c", "echo 'Source mounted at /source. Run \"opencode\" to start coding.'; exec /bin/bash" ]

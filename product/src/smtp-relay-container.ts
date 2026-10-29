/**
 * product/src/smtp-relay-container.ts — Durable Object fronting the SMTP relay
 * container. Stateless routing only: the Worker calls the container over the
 * private binding; the container is never exposed publicly and holds no secrets.
 */
import { Container } from "@cloudflare/containers";

export class SmtpRelayContainer extends Container {
  defaultPort = 8080;
  // Stay warm 30 min after idle: first-send latency matters more than the
  // trivial idle cost on this account.
  sleepAfter = "30m";
}

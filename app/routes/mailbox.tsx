// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useParams } from "react-router";
import AgentSidebar from "~/components/AgentSidebar";
import ComposeEmail from "~/components/ComposeEmail";
import Header from "~/components/Header";
import Sidebar from "~/components/Sidebar";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

/**
 * Renders the mailbox layout with navigation, nested content, and optional panels.
 *
 * @returns The mailbox route layout.
 */
export default function MailboxRoute() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  // Prefetch mailbox data for child components
  useMailbox(mailboxId);
  const prevMailboxIdRef = useRef<string | undefined>(undefined);
  const agentPanelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const {
    isSidebarOpen,
    closeSidebar,
    isAgentPanelOpen,
    toggleAgentPanel,
    closePanel,
    closeComposeModal,
  } = useUIStore();

  useEffect(() => {
    if (prevMailboxIdRef.current && mailboxId && prevMailboxIdRef.current !== mailboxId) {
      closePanel();
      closeComposeModal();
      closeSidebar();
    }

    prevMailboxIdRef.current = mailboxId;
  }, [mailboxId, closeComposeModal, closePanel, closeSidebar]);

  // Allow Esc to dismiss the mobile full-screen agent panel.
  useEffect(() => {
    if (!isAgentPanelOpen) return;
    const isMobile = () => window.innerWidth < 1024; // lg breakpoint
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobile()) toggleAgentPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAgentPanelOpen, toggleAgentPanel]);

  // Focus management and mobile-only focus trapping
  useEffect(() => {
    if (!isAgentPanelOpen) {
      // Restore focus when panel closes
      if (returnFocusRef.current) {
        returnFocusRef.current.focus();
        returnFocusRef.current = null;
      }
      return;
    }

    // SAFETY: document.activeElement is always an Element (or null when no focus); browser guarantees focusable elements are HTMLElement instances.
    returnFocusRef.current = document.activeElement as HTMLElement;

    const isMobile = () => window.innerWidth < 1024; // lg breakpoint

    // Mobile-only focus trapping for Tab navigation
    if (!isMobile()) return;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !agentPanelRef.current) return;

      const focusableElements = agentPanelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    window.addEventListener("keydown", handleTabKey);
    return () => window.removeEventListener("keydown", handleTabKey);
  }, [isAgentPanelOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar overlay backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={closeSidebar}
          onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar: hidden on mobile by default, shown as overlay when open */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 bg-kumo-base">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Agent + MCP sidebar — sheet overlay on mobile, docked panel on desktop */}
      {isAgentPanelOpen && (
        <>
          {/* Mobile backdrop — tap to dismiss */}
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={toggleAgentPanel}
            aria-label="Close agent panel"
          />
          <div
            ref={agentPanelRef}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[100vw] flex-col bg-kumo-base overflow-hidden shadow-xl sm:w-[380px] sm:max-w-[85vw] lg:relative lg:inset-auto lg:z-auto lg:w-[380px] lg:max-w-none lg:shrink-0 lg:shadow-none border-l border-kumo-line"
            role="complementary"
            aria-label="Agent panel"
            tabIndex={-1}
          >
            <AgentSidebar />
          </div>
        </>
      )}

      <ComposeEmail />
    </div>
  );
}

  border-top: 1px solid var(--field-border);
}

.modal-body {
  padding: 0 25px 20px;
}

.icon-button {
  width: 38px;
  height: 38px;
  border: 1px solid var(--field-border);
  border-radius: 9px;
  color: var(--text);
  background: transparent;
  font-size: 26px;
}

.switch-columns,
.settings-bottom {
  margin-top: 22px;
}

.lua-output {
  min-height: 450px;
}

.toast {
  position: fixed;
  right: 25px;
  bottom: 25px;
  z-index: 100;
  max-width: calc(100% - 50px);
  padding: 14px 20px;
  border: 1px solid var(--orange);
  border-radius: 10px;
  color: var(--text);
  background: #183450;
  box-shadow: 0 10px 40px #0006;
}

@media (max-width: 760px) {
  .container {
    width: calc(100% - 24px);
  }

  .header-description {
    display: none;
  }

  .two-columns {
    grid-template-columns: 1fr;
  }

  .panel {
    padding: 18px;
  }

  .footer {
    flex-direction: column;
  }

  .modal-header,
  .modal-footer {
    padding: 16px;
  }

  .modal-body {
    padding-inline: 16px;
  }

  .tab {
    padding: 10px 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

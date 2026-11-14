import React from 'react';
export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.error(JSON.stringify({ event: 'ui_render_error' }));
  }
  render() {
    if (this.state.failed)
      return (
        <main className="boot" role="alert">
          <h1>Не удалось открыть пространство</h1>
          <p>Сохранённые на сервере заметки не потеряны. Обновите страницу или вернитесь на обзор.</p>
          <button
            className="btn primary"
            onClick={() => {
              window.location.hash = '/';
              window.location.reload();
            }}
          >
            Вернуться на обзор
          </button>
        </main>
      );
    return this.props.children;
  }
}

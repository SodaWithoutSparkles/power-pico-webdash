import { NotificationCenter } from './components/common/NotificationCenter';
import { KeyboardShortcuts } from './components/common/KeyboardShortcuts';
import { MainLayout } from './components/layout/MainLayout';

function App() {
    return (
        <>
            <NotificationCenter />
            <KeyboardShortcuts />
            <MainLayout />
        </>
    );
}

export default App;

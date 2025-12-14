
import { Folder, List, Tv, Film, PlaySquare, LayoutGrid } from 'lucide-react';

const Sidebar = ({ 
    groups, 
    selectedGroup, 
    onSelectGroup, 
    categories, 
    selectedCategory, 
    onSelectCategory 
}) => {
    console.log('Sidebar categories:', categories);
    // Filter groups based on selected category
    const getFilteredGroups = () => {
        if (!selectedCategory || selectedCategory === 'all' || !categories) {
            return groups;
        }
        
        const categoryChannels = categories[selectedCategory] || [];
        const filteredGroups = {};
        categoryChannels.forEach(ch => {
            if (!filteredGroups[ch.group]) {
                filteredGroups[ch.group] = [];
            }
            filteredGroups[ch.group].push(ch);
        });
        return filteredGroups;
    };

    const filteredGroups = getFilteredGroups();

    return (
        <div className="w-56 bg-gray-100 border-r border-gray-200 h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <List size={16} />
                    Oynatma listesi
                </h2>
            </div>
            
            {/* Category Filters - Her zaman göster */}
            <div style={{ backgroundColor: '#1e293b', padding: '8px', borderBottom: '1px solid #334155' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                    <button
                        onClick={() => { onSelectCategory && onSelectCategory('all'); onSelectGroup('All'); }}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            backgroundColor: (!selectedCategory || selectedCategory === 'all') ? '#10b981' : '#334155',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                        title="Tümü"
                    >
                        <LayoutGrid size={16} />
                        <span style={{ marginTop: '2px' }}>Tümü</span>
                    </button>
                    <button
                        onClick={() => { onSelectCategory && onSelectCategory('live'); onSelectGroup('All'); }}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            backgroundColor: selectedCategory === 'live' ? '#ef4444' : '#334155',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                        title="Canlı TV"
                    >
                        <Tv size={16} />
                        <span style={{ marginTop: '2px' }}>TV</span>
                    </button>
                    <button
                        onClick={() => { onSelectCategory && onSelectCategory('movie'); onSelectGroup('All'); }}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            backgroundColor: selectedCategory === 'movie' ? '#f59e0b' : '#334155',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                        title="Filmler"
                    >
                        <Film size={16} />
                        <span style={{ marginTop: '2px' }}>Film</span>
                    </button>
                    <button
                        onClick={() => { onSelectCategory && onSelectCategory('series'); onSelectGroup('All'); }}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            backgroundColor: selectedCategory === 'series' ? '#d946ef' : '#334155',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                        title="Diziler"
                    >
                        <PlaySquare size={16} />
                        <span style={{ marginTop: '2px' }}>Dizi</span>
                    </button>
                </div>
            </div>
            
            {/* Playlist Tree */}
            <div className="flex-1 overflow-y-auto bg-white">
                {Object.keys(filteredGroups).length === 0 ? (
                    <div className="p-4 text-gray-500 text-sm">
                        Bu kategoride grup yok.
                    </div>
                ) : (
                    <div className="py-2">
                        {/* All Channels */}
                        <div
                            className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm hover:bg-gray-50 ${
                                selectedGroup === 'All' 
                                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-500' 
                                    : 'text-gray-700'
                            }`}
                            onClick={() => onSelectGroup('All')}
                        >
                            <Folder size={14} className="text-orange-500" />
                            <span>Tüm Kanallar</span>
                        </div>
                        
                        {/* Groups */}
                        {Object.keys(filteredGroups).map((group) => (
                            <div
                                key={group}
                                className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm hover:bg-gray-50 ${
                                    selectedGroup === group 
                                        ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-500' 
                                        : 'text-gray-700'
                                }`}
                                onClick={() => onSelectGroup(group)}
                            >
                                <Folder size={14} className="text-orange-500" />
                                <span className="truncate flex-1">{group}</span>
                                <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                    {filteredGroups[group].length}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Sidebar;

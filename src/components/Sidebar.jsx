import React from 'react';
import { Folder, List } from 'lucide-react';

const Sidebar = ({ groups, selectedGroup, onSelectGroup }) => {
    return (
        <div className="w-56 bg-gray-100 border-r border-gray-200 h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <List size={16} />
                    Oynatma listesi
                </h2>
            </div>
            
            {/* Playlist Tree */}
            <div className="flex-1 overflow-y-auto bg-white">
                {Object.keys(groups).length === 0 ? (
                    <div className="p-4 text-gray-500 text-sm">
                        Grup bulunamadı. Playlist yükleyin.
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
                        {Object.keys(groups).map((group) => (
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
                                    {groups[group].length}
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

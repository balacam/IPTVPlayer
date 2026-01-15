import React from 'react';
import { Tv, Clapperboard, Film, Clock } from 'lucide-react';

const CategoryCard = ({ title, icon: Icon, color, onClick, count }) => (
    <button
        onClick={onClick}
        className={`group relative overflow-hidden rounded-xl p-4 transition-all duration-300 hover:scale-105 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${color} h-40 flex flex-col items-center justify-center gap-2`}
    >
        <div className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-transparent" />

        {/* Icon Circle */}
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform duration-300 group-hover:scale-110">
            <Icon size={32} className="text-white drop-shadow-lg" />
        </div>

        {/* Title */}
        <div className="relative z-10 text-center">
            <h3 className="text-lg font-black tracking-wide text-white drop-shadow-md uppercase">
                {title}
            </h3>
            {count !== undefined && (
                <span className="block text-xs font-medium text-white/90">
                    {count} Items
                </span>
            )}
        </div>

        {/* Decorational Shine */}
        <div className="absolute -left-full top-0 h-full w-1/2 -skew-x-12 bg-white/10 blur-2xl transition-all duration-700 group-hover:left-full" />
    </button>
);

const CategorySelection = ({ categories, onSelectCategory }) => {
    console.log('CategorySelection rendering with:', {
        live: categories?.live?.length,
        movie: categories?.movie?.length,
        series: categories?.series?.length
    });

    return (
        <div className="flex h-screen w-full flex-col bg-[#0f172a] p-6 overflow-hidden">
            {/* Header */}
            <div className="mb-6 text-center">
                <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-1">
                    Categories
                </h1>
                <p className="text-gray-400 text-sm">Select the content type you want to watch</p>
            </div>

            {/* Grid - 2x2 layout */}
            <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-4 max-h-[calc(100vh-120px)]">
                {/* Live TV - Red */}
                <CategoryCard
                    title="LIVE TV"
                    icon={Tv}
                    color="bg-gradient-to-br from-red-600 to-red-800 ring-red-500"
                    count={categories?.live?.length || 0}
                    onClick={() => onSelectCategory('live')}
                />

                {/* Movies - Yellow/Orange */}
                <CategoryCard
                    title="MOVIES"
                    icon={Film}
                    color="bg-gradient-to-br from-amber-500 to-yellow-600 ring-amber-500"
                    count={categories?.movie?.length || 0}
                    onClick={() => onSelectCategory('movie')}
                />

                {/* Series - Pink/Magenta */}
                <CategoryCard
                    title="SERIES"
                    icon={Clapperboard}
                    color="bg-gradient-to-br from-fuchsia-500 to-pink-600 ring-fuchsia-500"
                    count={categories?.series?.length || 0}
                    onClick={() => onSelectCategory('series')}
                />

                {/* Catch Up - Green */}
                <CategoryCard
                    title="CATCH UP"
                    icon={Clock}
                    color="bg-gradient-to-br from-green-500 to-emerald-700 ring-green-500"
                    count={0}
                    onClick={() => onSelectCategory('all')}
                />
            </div>
        </div>
    );
};

export default CategorySelection;
